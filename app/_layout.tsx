import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDb } from '../src/lib/db';

// Root layout is a Stack. The (tabs) group holds the three tab pages
// (Inventory, Tools, Settings); the detail and tool screens push on top
// of the tabs with a back button, which is the standard expo-router
// Tabs + Stack pattern.

export default function RootLayout() {
  useEffect(() => {
    // Local-first: create tables and seed the 192 Purchase-sheet items on first run.
    initDb();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#fff' },
          headerTintColor: '#1f2328',
          headerTitleStyle: { fontSize: 17, fontWeight: '700' },
          // The back button otherwise reads "(tabs)" — the route name of
          // the tab group the detail screens push from.
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="item/[id]" options={{ title: 'Item' }} />
        <Stack.Screen name="listing/[id]" options={{ title: 'Listing draft' }} />
        <Stack.Screen name="add" options={{ title: 'Add item' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan QR' }} />
        <Stack.Screen name="labels" options={{ title: 'QR labels' }} />
        <Stack.Screen name="calculator" options={{ title: 'Margin calculator' }} />
        <Stack.Screen name="sync" options={{ title: 'Sheet sync' }} />
        <Stack.Screen name="expenses" options={{ title: 'Expenses' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
