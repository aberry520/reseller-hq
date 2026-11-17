import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initDb } from '../src/lib/db';

export default function RootLayout() {
  useEffect(() => {
    // Local-first: create tables and seed the 192 Purchase-sheet items on first run.
    initDb();
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Reseller HQ' }} />
        <Stack.Screen name="item/[id]" options={{ title: 'Item' }} />
        <Stack.Screen name="listing/[id]" options={{ title: 'Listing draft' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan QR' }} />
        <Stack.Screen name="add" options={{ title: 'Add item' }} />
        <Stack.Screen name="labels" options={{ title: 'QR labels' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </>
  );
}
