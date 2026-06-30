/* Shim: GCC's <mm_malloc.h> -> MSVC provides _mm_malloc/_mm_free in <malloc.h>. */
#ifndef KALIGN_SHIM_MM_MALLOC_H
#define KALIGN_SHIM_MM_MALLOC_H
#include <malloc.h>
#endif
