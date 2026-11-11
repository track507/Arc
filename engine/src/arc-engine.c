// Just a forewarning, Im not a C programmer
// The closest thing I've done to this in C++ and recently some rust stuff so bear with me here

// * Arc's engine: the one palce the C side of the engine is wired
// a wasm instance holds on quickjs runtime and one context, and a new runtime is a enw instance with fresh memory
// js side writes a script into the input buffer, calls arc_run, and reads the outcome from the output buffer
// the outcome is a list of fields, each a 4 byte little endian length and that many bytes of UTF-8 since a JS string can hold a nul char

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "quickjs.h"

// arc owns these return values
enum
{
	ARC_VALUE = 0,
	ARC_ERROR = 1,
	ARC_UNREADABLE = 2,
};

static JSRuntime *runtime;
static JSContext *context;

// both of these buffers live as long as the instance, so they grow and are never freed
static char *input;
static uint32_t input_capacity;
static char *output;
static uint32_t output_capacity;
static uint32_t output_length;

// grow a buffer to hold at least size byte and keep its contents
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

// appends one field, its lenght, and its bytes, and returns 0 when memory runs out
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

// append a values text as a field, or empty field when making the text throws
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
// a thrown value that is not an Error has n empty name, its text as the message and an empty stack
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

// create the actual runtime and its context and returns 0, or a neg number naming on that couldnt be made
int arc_start(void)
{
	runtime = JS_NewRuntime();
	if (runtime == NULL)
		return -1;
	context = JS_NewContext(runtime);
	if (context == NULL)
		return -2;
	return 0;
}

// return an input buffer of atleast size bytes or null when no memory
char *arc_input(uint32_t size)
{
	return reserve(&input, &input_capacity, size) ? input : NULL;
}

// Run the script in the input buffer as a global script and write its output to the output buffer
// the input holds nul byte, source, and another nul byte since JS_Eval needs to be terminated
// The source may hold nul chars of its own bc its lenght is passed
int arc_run(uint32_t name_length, uint32_t source_length)
{
	const char *name = input;
	const char *source = input + name_length + 1;
	output_length = 0;
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
	return write_error() ? ARC_ERROR : ARC_UNREADABLE;
}

// Every run overrides the previous
const char *arc_output(void)
{
	return output;
}

uint32_t arc_output_length(void)
{
	return output_length;
}
