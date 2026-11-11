// Just a forewarning, I'm not a C programmer
// The closest thing I've done to this is C++ and recently some Rust stuff, so bear with me here

// * Arc's engine: the one place the C side of the engine is wired
// a wasm instance holds one quickjs runtime and one context, and a new runtime is a new instance with fresh memory
// js side writes a script into the input buffer, calls arc_run, and reads the outcome from the output buffer
// the outcome is a list of fields, each a 4 byte little endian length and that many bytes of UTF-8 since a JS string can hold a nul char

#include <emscripten/em_js.h>
#include <malloc.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "quickjs.h"

#ifndef ARC_STACK_LIMIT
#error "ARC_STACK_LIMIT, the engine's stack limit in bytes, comes from engine/scripts/build.ts"
#endif

// arc owns these return values
enum
{
	ARC_VALUE = 0,
	ARC_ERROR = 1,
	ARC_UNREADABLE = 2,
	ARC_TIMEOUT = 3,
};

static JSRuntime *runtime;
static JSContext *context;
static size_t memory_limit;
static int timed_out;

// both of these buffers live as long as the instance, so they grow and are never freed
static char *input;
static uint32_t input_capacity;
static char *output;
static uint32_t output_capacity;
static uint32_t output_length;

// grow a buffer to hold at least size bytes and keep its contents
static int reserve(char **buffer, uint32_t *capacity, uint32_t size)
{
	if (size <= *capacity)
		return 1;

	if (size > UINT32_MAX / 2)
		return 0;

	uint32_t next = *capacity == 0 ? 4096 : *capacity;
	while (next < size)
	{
		next *= 2;
	}

	char *grown = realloc(*buffer, next);
	if (grown == NULL)
		return 0;

	*buffer = grown;
	*capacity = next;
	return 1;
}

// appends one field, its length, and its bytes, and returns 0 when memory runs out
static int write_field(const char *bytes, size_t length)
{
	if (length > UINT32_MAX / 4 || !reserve(&output, &output_capacity, output_length + 4 + (uint32_t)length))
		return 0;

	uint32_t size = (uint32_t)length;
	memcpy(output + output_length, &size, 4);
	memcpy(output + output_length + 4, bytes, length);

	output_length += 4 + size;
	return 1;
}

// drops the pending exception so it cannot surface on the next run
static void drop_exception(void)
{
	JS_FreeValue(context, JS_GetException(context));
}

// append a value's text as a field, or an empty field when making the text throws
static int write_text(JSValueConst value)
{
	size_t length;
	const char *text = JS_ToCStringLen(context, &length, value);
	if (text == NULL)
	{
		drop_exception();
		return write_field("", 0);
	}

	int written = write_field(text, length);
	JS_FreeCString(context, text);
	return written;
}

// append a property of an error as a field, empty when the error lacks it or reading it throws
static int write_property(JSValueConst error, const char *name)
{
	JSValue property = JS_GetPropertyStr(context, error, name);
	if (JS_IsException(property))
	{
		drop_exception();
		return write_field("", 0);
	}
	int written = JS_IsUndefined(property) ? write_field("", 0) : write_text(property);
	JS_FreeValue(context, property);
	return written;
}

// Write the pending exception as 3 fields: name, message, and stack
// a thrown value that is not an Error has an empty name, its text as the message and an empty stack
static int write_error(void)
{
	JSValue error = JS_GetException(context);
	int written;
	if (JS_IsError(context, error))
		written = write_property(error, "name") && write_property(error, "message") && write_property(error, "stack");
	else
		written = write_field("", 0) && write_text(error) && write_field("", 0);
	JS_FreeValue(context, error);
	return written;
}

// * The allocator
// ? The release's allocator counts each block at the size malloc_usable_size reports, but under Emscripten it takes that size as 0, so its memory limit sees only 8 bytes a block
// ? Emscripten's malloc does report a block's size, so these are the release's allocator functions with that size put back
// ? quickjs/quickjs.c, js_def_malloc_usable_size, and Emscripten's system/lib/dlmalloc.c, malloc_usable_size

/** What malloc spends on a block beyond its usable size, as the release's allocator counts it */
#define BLOCK_OVERHEAD 8

// * The fault hook
// ? Only the fault build compiles it, with ARC_FAULTS, and engine/scripts/compile.ts names the entry points that build exports
// ? A test makes the nth allocation from now fail, which reaches a fault that waits on one exact allocation failing, on every run
// ? The fault build also sets __SANITIZE_ADDRESS__, which makes the release send every allocation here instead of serving small blocks from arenas of its own

#ifdef ARC_FAULTS
static uint32_t fail_countdown;
static uint32_t allocations;

/** Counts an allocation and answers whether it is the one set to fail */
static int fail_now(void)
{
	allocations++;
	if (fail_countdown == 0)
		return 0;
	return --fail_countdown == 0;
}

/** Makes the nth allocation from now fail, a malloc or a realloc that grows its block, or none with 0, and starts the count again */
void arc_fail_at(uint32_t n)
{
	fail_countdown = n;
	allocations = 0;
}

/** The allocations since the last arc_fail_at */
uint32_t arc_allocations(void)
{
	return allocations;
}
#else
/** The product build fails no allocation of its own */
static inline int fail_now(void)
{
	return 0;
}
#endif

/** A block's usable size, which malloc may round up from the size asked for */
static size_t block_size(const void *block)
{
	return malloc_usable_size((void *)block);
}

/**
 * Allocates a block, or returns NULL when it would take the runtime past its memory limit
 *
 * ? JS_NewRuntime2 leaves the limit to the allocator, so this repeats the release allocator's test
 */
static void *limited_malloc(JSMallocState *state, size_t size)
{
	if (fail_now())
		return NULL;
	if (state->malloc_size + size > state->malloc_limit)
		return NULL;
	void *block = malloc(size);
	if (block == NULL)
		return NULL;
	state->malloc_count++;
	state->malloc_size += block_size(block) + BLOCK_OVERHEAD;
	return block;
}

/** Frees a block and takes its size off the runtime's count */
static void limited_free(JSMallocState *state, void *block)
{
	if (block == NULL)
		return;
	state->malloc_count--;
	state->malloc_size -= block_size(block) + BLOCK_OVERHEAD;
	free(block);
}

/** Resizes a block, or returns NULL and leaves the block as it was when the new size would take the runtime past its memory limit */
static void *limited_realloc(JSMallocState *state, void *block, size_t size)
{
	if (block == NULL)
		return size == 0 ? NULL : limited_malloc(state, size);
	if (size == 0)
	{
		limited_free(state, block);
		return NULL;
	}
	size_t old_size = block_size(block);
	if (size > old_size && fail_now())
		return NULL;
	if (state->malloc_size + size - old_size > state->malloc_limit)
		return NULL;
	void *resized = realloc(block, size);
	if (resized == NULL)
		return NULL;
	state->malloc_size += block_size(resized) - old_size;
	return resized;
}

static const JSMallocFunctions allocator = {limited_malloc, limited_free, limited_realloc, block_size};

// * The deadline
// ? The JavaScript side keeps the run's deadline and hands this answer to the loader as arcShouldStop, which becomes a property of the module

EM_JS(int, arc_host_should_stop, (), { return Module["arcShouldStop"]() ? 1 : 0; }); // asks the js side whether the current run passed its deadline

/**
 * Stops the run once the JavaScript side says it has passed its deadline, and records that the stop was a timeout
 *
 * ? QuickJS calls it once every JS_INTERRUPT_COUNTER_INIT jumps and calls, 10,000 in the release, and the regular expression engine calls it while it backtracks
 * ? Returning 1 makes QuickJS throw InternalError: interrupted, which no catch or finally block in the script can stop
 */
static int interrupt(JSRuntime *rt, void *opaque)
{
	(void)rt;
	(void)opaque;
	if (!arc_host_should_stop())
		return 0;
	timed_out = 1;
	return 1;
}

/**
 * Creates the runtime and its context under a memory limit in bytes, and returns 0, or a negative number naming the one that could not be made
 *
 * A limit of UINT32_MAX is SIZE_MAX in wasm32, which leaves only the memory maximum
 * The stack limit counts from where the runtime is created, which is where every later run starts too, since each call comes straight from JavaScript
 */
int arc_start(uint32_t limit)
{
	runtime = JS_NewRuntime2(&allocator, NULL);
	if (runtime == NULL)
		return -1;
	memory_limit = limit;
	JS_SetMemoryLimit(runtime, memory_limit);
	JS_SetMaxStackSize(runtime, ARC_STACK_LIMIT); // ! the release defaults to 1 MiB, which is more than the whole shadow stack, so without this the limit lands below address 0 and every call overflows
	JS_SetInterruptHandler(runtime, interrupt, NULL);
	context = JS_NewContext(runtime);
	if (context == NULL)
		return -2;
	return 0;
}

// return an input buffer of at least size bytes or null when no memory
char *arc_input(uint32_t size)
{
	return reserve(&input, &input_capacity, size) ? input : NULL;
}

// Run the script in the input buffer as a global script and write its outcome to the output buffer
// returns 0 for a value, 1 for an error, 2 for an outcome that couldn't be written, and 3 for a timeout
// the input holds the name, a nul byte, the source, and another nul byte since JS_Eval needs both terminated
// The source may hold nul chars of its own because its length is passed
int arc_run(uint32_t name_length, uint32_t source_length)
{
	const char *name = input;
	const char *source = input + name_length + 1;
	output_length = 0;
	timed_out = 0;
	JSValue result = JS_Eval(context, source, source_length, name, JS_EVAL_TYPE_GLOBAL);
	if (!JS_IsException(result))
	{
		size_t length;
		const char *text = JS_ToCStringLen(context, &length, result);
		JS_FreeValue(context, result);
		if (text != NULL)
		{
			int written = write_field(text, length);
			JS_FreeCString(context, text);
			return written ? ARC_VALUE : ARC_UNREADABLE;
		}
		// ? Making the value's text threw, as a Symbol's does, so the run ends with that error
	}
	if (timed_out)
	{
		drop_exception();
		return ARC_TIMEOUT;
	}
	// ? An error raised at the memory limit leaves no room under it to read the error's text, so the limit is lifted for the read and only the memory maximum bounds it
	JS_SetMemoryLimit(runtime, SIZE_MAX);
	int written = write_error();
	JS_SetMemoryLimit(runtime, memory_limit);
	return written ? ARC_ERROR : ARC_UNREADABLE;
}

// Every run overwrites the previous
const char *arc_output(void)
{
	return output;
}

uint32_t arc_output_length(void)
{
	return output_length;
}

#ifdef ARC_FAULTS
/** The blocks the runtime holds after a full collection, which a leaked block raises by one */
uint32_t arc_live_blocks(void)
{
	JSMemoryUsage usage;
	JS_RunGC(runtime);
	JS_ComputeMemoryUsage(runtime, &usage);
	return (uint32_t)usage.malloc_count;
}
#endif
