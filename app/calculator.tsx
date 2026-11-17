// Margin calculator — a standalone tool, not tied to any item. Works for any
// sale: eBay, Facebook, local. Type any four numbers and the margin, profit
// and breakdown update as you type. Nothing here is saved.

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSettings } from '../src/lib/db';
import { formatMoney, marginPct } from '../src/lib/pricing';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';

function parseMoney(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export default function CalculatorScreen() {
  const insets = useSafeAreaInsets();
  const settings = getSettings();
  const [cost, setCost] = useState('');
  const [ship, setShip] = useState('');
  const [feeStr, setFeeStr] = useState('');
  const [price, setPrice] = useState('');

  const cCost = parseMoney(cost);
  const cShip = parseMoney(ship);
  const cPrice = parseMoney(price);
  // Fee is its own input. Left blank it uses the eBay fee on the selling
  // price; type 0 for a sale with no fee (local pickup, Facebook).
  const feeBlank = feeStr.trim() === '';
  const cFee = feeBlank ? cPrice * settings.ebayFeePct : parseMoney(feeStr);
  const cProfit = cPrice - cFee - cCost - cShip;
  const cMarginPct = cPrice > 0 ? marginPct(cProfit / cPrice) : 0;
  const ok = cMarginPct >= settings.targetMarginPct * 100;

  const clear = () => {
    setCost('');
    setShip('');
    setFeeStr('');
    setPrice('');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
    >
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Margin calculator</Text>
        <Text style={styles.note}>
          Works for any sale — eBay, Facebook, local. Nothing here is saved.
        </Text>
        <View style={styles.moneyGrid}>
          <View style={styles.moneyField}>
            <Text style={styles.fieldLabel}>Cost</Text>
            <TextInput
              style={styles.input}
              value={cost}
              onChangeText={setCost}
              keyboardType="decimal-pad"
              placeholder="0.00"
              returnKeyType="done"
            />
          </View>
          <View style={styles.moneyField}>
            <Text style={styles.fieldLabel}>Shipping</Text>
            <TextInput
              style={styles.input}
              value={ship}
              onChangeText={setShip}
              keyboardType="decimal-pad"
              placeholder="0.00"
              returnKeyType="done"
            />
          </View>
          <View style={styles.moneyField}>
            <Text style={styles.fieldLabel}>Fee</Text>
            <TextInput
              style={styles.input}
              value={feeStr}
              onChangeText={setFeeStr}
              keyboardType="decimal-pad"
              placeholder="13.6% eBay"
              returnKeyType="done"
            />
          </View>
          <View style={styles.moneyField}>
            <Text style={styles.fieldLabel}>Selling price</Text>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="0.00"
              returnKeyType="done"
            />
          </View>
        </View>
        <Text style={styles.note}>
          Fee left blank uses the {(settings.ebayFeePct * 100).toFixed(1)}% eBay fee.
          Type 0 for a sale with no fee.
        </Text>
        {cPrice > 0 ? (
          <View style={styles.calcBox}>
            <Text style={[styles.calcMargin, ok ? styles.pass : styles.fail]}>
              {cMarginPct.toFixed(1)}% margin
            </Text>
            <Text style={styles.calcProfit}>Profit {formatMoney(cProfit)}</Text>
            <Text style={styles.line}>Selling price {formatMoney(cPrice)}</Text>
            <Text style={styles.line}>
              {feeBlank
                ? `Fee (${(settings.ebayFeePct * 100).toFixed(1)}% eBay)`
                : 'Fee'}{' '}
              −{formatMoney(cFee)}
            </Text>
            <Text style={styles.line}>Cost −{formatMoney(cCost)}</Text>
            <Text style={styles.line}>Shipping −{formatMoney(cShip)}</Text>
          </View>
        ) : (
          <Text style={styles.note}>Enter a selling price to see the margin.</Text>
        )}
        <Pressable style={[styles.btn, styles.clearBtn]} onPress={clear}>
          <Text style={styles.btnText}>Clear</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  calcBox: {
    backgroundColor: '#fff',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  calcMargin: { fontSize: 30, fontWeight: '800', lineHeight: 36 },
  calcProfit: { color: colors.text, fontSize: 19, fontWeight: '700', marginTop: 2 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    margin: spacing.lg,
    padding: spacing.lg,
  },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  clearBtn: { backgroundColor: colors.muted },
  container: { backgroundColor: colors.background, flex: 1 },
  fail: { color: colors.danger, fontWeight: '700' },
  fieldLabel: { color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  input: {
    backgroundColor: '#fff',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    fontSize: 16,
    minHeight: minTouchHeight,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  line: { color: colors.text, fontSize: 16, lineHeight: 24, marginTop: 2 },
  moneyField: { flexBasis: '48%', flexGrow: 1 },
  moneyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
  pass: { color: colors.success, fontWeight: '700' },
});
