import { useEffect, useRef, useState, useCallback } from 'react';

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_DURATION_MS = 60 * 1000; // 60 seconds countdown

export function useInactivityReboot() {
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const inactivityTimerRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);

  const clearAllData = useCallback(() => {
    // Clear localStorage
    localStorage.clear();
    
    // Clear IndexedDB
    const deleteRequest = indexedDB.deleteDatabase('thesis-checker-db');
    deleteRequest.onsuccess = () => {
      console.log('[Reboot] IndexedDB cleared');
    };
    deleteRequest.onerror = () => {
      console.error('[Reboot] Failed to clear IndexedDB');
    };

    // Reload the page
    window.location.reload();
  }, []);

  const startWarningCountdown = useCallback(() => {
    setShowWarning(true);
    setCountdown(60);

    countdownIntervalRef.current = window.setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // Time's up - clear everything
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
          }
          clearAllData();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearAllData]);

  const resetInactivityTimer = useCallback(() => {
    // Clear existing timers
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    // Hide warning if shown
    setShowWarning(false);
    setCountdown(60);

    // Start new inactivity timer
    inactivityTimerRef.current = window.setTimeout(() => {
      startWarningCountdown();
    }, INACTIVITY_TIMEOUT_MS);
  }, [startWarningCountdown]);

  const stayActive = useCallback(() => {
    resetInactivityTimer();
  }, [resetInactivityTimer]);

  const rebootNow = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }
    clearAllData();
  }, [clearAllData]);

  useEffect(() => {
    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];

    const handleActivity = () => {
      if (!showWarning) {
        resetInactivityTimer();
      }
    };

    // Start initial timer
    resetInactivityTimer();

    // Add event listeners
    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      // Cleanup
      activityEvents.forEach(event => {
        document.removeEventListener(event, handleActivity);
      });
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [resetInactivityTimer, showWarning]);

  return {
    showWarning,
    countdown,
    stayActive,
    rebootNow
  };
}
