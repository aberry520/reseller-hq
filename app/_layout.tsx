import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDb } from '../src/lib/db';
import { colors } from '../src/lib/ui';

// Three pages, bottom tab bar:
//   Inventory — the list, search, filters, select/delete, add.
//   Tools — the helpers: margin calculator, QR scanner, QR labels.
//   Settings — edit the app's settings.
// Detail and tool screens (item, listing draft, add, scan, labels,
// calculator) are pushed on top: hidden from the tab bar, tab bar hidden
// while they are open.

export default function RootLayout() {
  useEffect(() => {
    // Local-first: create tables and seed the 192 Purchase-sheet items on first run.
    initDb();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: '#fff' },
          headerTintColor: '#1f2328',
          headerTitleStyle: { fontSize: 17, fontWeight: '700' },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Inventory',
            tabBarIcon: ({ focused, size }) => (
              <Ionicons
                name="list-outline"
                color={focused ? colors.primary : colors.muted}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="tools"
          options={{
            title: 'Tools',
            tabBarIcon: ({ focused, size }) => (
              <Ionicons
                name="construct-outline"
                color={focused ? colors.primary : colors.muted}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ focused, size }) => (
              <Ionicons
                name="settings-outline"
                color={focused ? colors.primary : colors.muted}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="item/[id]"
          options={{ title: 'Item', href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="listing/[id]"
          options={{ title: 'Listing draft', href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="add"
          options={{ title: 'Add item', href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="scan"
          options={{ title: 'Scan QR', href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="labels"
          options={{ title: 'QR labels', href: null, tabBarStyle: { display: 'none' } }}
        />
        <Tabs.Screen
          name="calculator"
          options={{ title: 'Margin calculator', href: null, tabBarStyle: { display: 'none' } }}
        />
      </Tabs>
    </SafeAreaProvider>
  );
}
