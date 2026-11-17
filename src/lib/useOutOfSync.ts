// useOutOfSync — live read of the out-of-sync flag (db.ts). The flag is
// set when a sheet push fails (offline) and cleared when a push or a
// sync apply succeeds. Screens use this to gate item transactions until
// the app is back in sync, and the banner uses it to know when to show.

import { useEffect, useState } from 'react';
import { isOutOfSync, onOutOfSyncChange } from './db';

export function useOutOfSync(): boolean {
  const [out, setOut] = useState<boolean>(() => isOutOfSync());
  useEffect(() => {
    setOut(isOutOfSync());
    return onOutOfSyncChange(() => setOut(isOutOfSync()));
  }, []);
  return out;
}
