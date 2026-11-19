// InfoButton: a small "i" icon that opens the explanatory text for the
// thing it sits next to, so cards stay clean and the help is one tap
// away instead of always on screen.

import { Alert, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/ui';

export default function InfoButton(props: { title: string; message: string }) {
  return (
    <Pressable
      style={styles.btn}
      onPress={() => Alert.alert(props.title, props.message)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel={`About: ${props.title}`}
    >
      <Ionicons name="information-circle-outline" size={20} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center', padding: 2 },
});
