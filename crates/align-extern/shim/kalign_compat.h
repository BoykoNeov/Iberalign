/* Force-included (cl /FI) MSVC compatibility shim for KAlign v3.5.1.
   Maps the handful of POSIX/GCC-isms KAlign uses to MSVC equivalents. */
#ifndef KALIGN_MSVC_COMPAT_H
#define KALIGN_MSVC_COMPAT_H

#ifdef _MSC_VER
  #include <intrin.h>
  #include <io.h>       /* _write */
  #include <process.h>  /* _getpid */

  /* GCC builtin -> MSVC intrinsic */
  #ifndef __builtin_popcount
    #define __builtin_popcount __popcnt
  #endif

  /* POSIX io/process -> MSVC underscore names */
  #ifndef write
    #define write _write
  #endif
  #ifndef getpid
    #define getpid _getpid
  #endif

  /* MSVC lacks ssize_t in some headers */
  #include <basetsd.h>
  #ifndef _SSIZE_T_DEFINED
    typedef SSIZE_T ssize_t;
    #define _SSIZE_T_DEFINED
  #endif

  /* POSIX localtime_r -> MSVC localtime_s (swapped args, errno return) */
  #include <time.h>
  static __inline struct tm *localtime_r(const time_t *t, struct tm *out) {
    return localtime_s(out, t) == 0 ? out : (struct tm *)0;
  }
#endif /* _MSC_VER */

#endif
