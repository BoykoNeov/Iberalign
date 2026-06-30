/* Shim: minimal <unistd.h> for MSVC. KAlign uses write()/getpid() only. */
#ifndef KALIGN_SHIM_UNISTD_H
#define KALIGN_SHIM_UNISTD_H
#include <io.h>
#include <process.h>
#endif
