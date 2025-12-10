import { useEffect, useCallback } from 'react';

/**
 * Hook that triggers a callback when the page becomes visible after being hidden.
 * Useful for reloading data after the browser tab was inactive for a while.
 */
export function useVisibilityReload(onReload: () => void) {
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible') {
      console.log('[VisibilityReload] Tab became visible, triggering reload');
      onReload();
    }
  }, [onReload]);

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Also reload on window focus (covers some edge cases)
    const handleFocus = () => {
      console.log('[VisibilityReload] Window focused, triggering reload');
      onReload();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [handleVisibilityChange, onReload]);
}
