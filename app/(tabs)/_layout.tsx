import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/lib/ui';

// The four tab pages: Dashboard, Inventory, Tools, Settings.
// Detail and tool screens (item, listing draft, add, scan, labels,
// calculator) are NOT tabs — they live in the root Stack above this
// group, so they push on top with a back button and the tab bar hidden.
// (They used to be declared here with href: null; in this expo-router
// version a hidden tab route gets redirected back to the first tab the
// moment it is focused, which is what broke all navigation to them.)

export default function TabsLayout() {
  return (
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
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused, size }) => (
            <Ionicons
              name="stats-chart-outline"
              color={focused ? colors.primary : colors.muted}
              size={size}
            />
          ),
        }}
      />
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
    </Tabs>
  );
}
