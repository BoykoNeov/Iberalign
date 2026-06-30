/* Shim: minimal <sys/time.h> for MSVC. KAlign's esl_stopwatch uses
   gettimeofday() + struct timeval (timing only). */
#ifndef KALIGN_SHIM_SYS_TIME_H
#define KALIGN_SHIM_SYS_TIME_H

#include <winsock2.h>  /* struct timeval lives here on MSVC */
#include <windows.h>

static __inline int gettimeofday(struct timeval *tv, void *tz) {
    /* 100-ns intervals since 1601-01-01 -> Unix epoch microseconds */
    FILETIME ft;
    unsigned long long t;
    (void)tz;
    GetSystemTimeAsFileTime(&ft);
    t = ((unsigned long long)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
    t -= 116444736000000000ULL;   /* 1601 -> 1970 */
    t /= 10;                       /* 100ns -> us */
    tv->tv_sec  = (long)(t / 1000000ULL);
    tv->tv_usec = (long)(t % 1000000ULL);
    return 0;
}
#endif
