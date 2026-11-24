import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDb } from '../src/lib/db';
import { ThemeProvider, useTheme } from '../src/lib/theme-context';
import SyncBanner from '../src/components/SyncBanner';

// Root layout is a Stack. The (tabs) group holds the three tab pages
// (Inventory, Tools, Settings); the detail and tool screens push on top
// of the tabs with a back button, which is the standard expo-router
// Tabs + Stack pattern.

function AppShell() {
  const { colors, dark } = useTheme();
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <SyncBanner />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
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
        <Stack.Screen name="mark-labeled" options={{ title: 'Mark as labeled' }} />
        <Stack.Screen name="calculator" options={{ title: 'Margin calculator' }} />
        <Stack.Screen name="sync" options={{ title: 'Sheet sync' }} />
        <Stack.Screen name="expenses" options={{ title: 'Expenses' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Local-first: create tables and seed the 192 Purchase-sheet items on first run.
    initDb();
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
