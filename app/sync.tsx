// Sheet sync — two-way, review-first (git-style).
// "Check for changes" fetches the sheet and compares it with the app's
// items. Nothing is written anywhere until Austin approves the diff and
// taps Apply. App → sheet writes only the input columns (never the sheet's
// formula columns); sheet → app imports update the app's copy of those
// same fields. Photos stay in the app; the sheet's summary block is
// untouched.

import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllItems, getDeletedIds, getSettings, getSyncState } from '../src/lib/db';
import { applySync, fetchSheetRows, SyncResult } from '../src/lib/sync';
import { computeDiff, SyncDiff } from '../src/lib/sync-diff';
import { cleanName } from '../src/lib/listing';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';

type Phase = 'idle' | 'checking' | 'ready' | 'applying' | 'done' | 'error';

export default function SyncScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [diff, setDiff] = useState<SyncDiff | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);

  // Selections — all default to checked except "removed from sheet".
  const [appOnlySel, setAppOnlySel] = useState<Set<string>>(new Set());
  const [sheetOnlySel, setSheetOnlySel] = useState<Set<number>>(new Set());
  const [changedChoice, setChangedChoice] = useState<Record<string, 'app' | 'sheet'>>({});
  const [trashSel, setTrashSel] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      const s = getSettings();
      setConfigured(!!s.syncUrl.trim() && !!s.syncToken.trim());
      setLastSyncAt(getSyncState()?.at ?? null);
    }, []),
  );

  const check = async () => {
    setPhase('checking');
    setError('');
    setResult(null);
    try {
      const rows = await fetchSheetRows();
      const d = computeDiff(getAllItems(), rows, {
        tombstones: getDeletedIds(),
        syncedIds: getSyncState()?.ids ?? [],
      });
      setDiff(d);
      setAppOnlySel(new Set(d.appOnly.filter((e) => !e.wasSynced).map((e) => e.item.id)));
      setSheetOnlySel(new Set(d.sheetOnly.map((r) => r.row)));
      const choices: Record<string, 'app' | 'sheet'> = {};
      for (const c of d.changed) choices[c.item.id] = 'app';
      setChangedChoice(choices);
      setTrashSel(new Set(d.deletedInApp));
      setPhase('ready');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setPhase('error');
    }
  };

  const selectedCount = () => {
    if (!diff) return 0;
    let n = appOnlySel.size + sheetOnlySel.size + trashSel.size;
    for (const c of diff.changed) if (changedChoice[c.item.id]) n += 1;
    return n;
  };

  const apply = async () => {
    if (!diff) return;
    setPhase('applying');
    setError('');
    try {
      const r = await applySync({
        upsertAppIds: [
          ...appOnlySel,
          ...diff.changed.filter((c) => changedChoice[c.item.id] === 'app').map((c) => c.item.id),
        ],
        importSheetRows: diff.sheetOnly.filter((s) => sheetOnlySel.has(s.row)),
        sheetWins: diff.changed
          .filter((c) => changedChoice[c.item.id] === 'sheet')
          .map((c) => ({ id: c.item.id, sheet: c.sheet })),
        trashAppIds: [...trashSel],
      });
      setResult(r);
      setDiff(null);
      setLastSyncAt(getSyncState()?.at ?? null);
      setPhase('done');
      if (r.errors.length > 0) {
        Alert.alert('Sync finished with errors', r.errors.slice(0, 5).join('\n'));
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setPhase('error');
    }
  };

  const toggle = <T,>(set: Set<T>, setFn: (s: Set<T>) => void, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setFn(next);
  };

  const checkBox = (on: boolean) => (
    <View style={[styles.checkbox, on && styles.checkboxChecked]}>
      {on && <Text style={styles.checkMark}>✓</Text>}
    </View>
  );

  if (!configured) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
      >
        <Text style={styles.title}>Sheet sync is not set up yet</Text>
        <Text style={styles.body}>
          The app talks to the sheet through a small script attached to it (sync/sheet-sync.gs in
          the repo). One-time setup:
        </Text>
        <Text style={styles.body}>
          1. In the sheet: Extensions → Apps Script, paste in sheet-sync.gs.{'\n'}
          2. Project Settings → Script Properties → add SYNC_TOKEN (pick a long random string).{'\n'}
          3. Deploy → New deployment → Web app, Execute as Me, Who has access Anyone. Copy the URL.{'\n'}
          4. Paste the URL and the same token into Settings below.
        </Text>
        <Pressable style={styles.btn} onPress={() => router.push('/settings')}>
          <Text style={styles.btnText}>Open Settings</Text>
        </Pressable>
      </ScrollView>
    );
  }

  const totalChanges = diff
    ? diff.appOnly.length + diff.sheetOnly.length + diff.changed.length + diff.deletedInApp.length
    : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
    >
      <Text style={styles.title}>Sheet sync</Text>
      <Text style={styles.body}>
        Compares the app with the Purchase sheet, shows what is different, and applies only what
        you check. Nothing is written to the sheet until you tap Apply.
      </Text>
      {lastSyncAt ? (
        <Text style={styles.meta}>Last applied: {new Date(lastSyncAt).toLocaleString()}</Text>
      ) : (
        <Text style={styles.meta}>Never synced from this device.</Text>
      )}

      <Pressable
        style={[styles.btn, phase === 'checking' && styles.disabledBtn]}
        onPress={check}
        disabled={phase === 'checking' || phase === 'applying'}
      >
        <Text style={styles.btnText}>
          {phase === 'checking' ? 'Checking…' : 'Check for changes'}
        </Text>
      </Pressable>

      {phase === 'error' && !!error && <Text style={styles.error}>{error}</Text>}

      {phase === 'done' && result && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>Applied</Text>
          <Text style={styles.body}>Added to sheet: {result.addedToSheet}</Text>
          <Text style={styles.body}>Updated in sheet: {result.updatedSheet}</Text>
          <Text style={styles.body}>Added to app: {result.addedToApp}</Text>
          <Text style={styles.body}>Updated in app: {result.updatedApp}</Text>
          <Text style={styles.body}>Marked Trash in sheet: {result.trashedInSheet}</Text>
          {result.errors.length > 0 && (
            <Text style={styles.error}>{result.errors.slice(0, 5).join('\n')}</Text>
          )}
          <Text style={styles.body}>Tap “Check for changes” again to confirm a clean diff.</Text>
        </View>
      )}

      {phase === 'ready' && diff && totalChanges === 0 && (
        <Text style={styles.body}>Everything matches — the app and the sheet are in sync.</Text>
      )}

      {phase === 'ready' && diff && totalChanges > 0 && (
        <>
          {diff.appOnly.filter((e) => !e.wasSynced).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>New in app — will be added to the sheet</Text>
              {diff.appOnly
                .filter((e) => !e.wasSynced)
                .map((e) => (
                  <Pressable
                    key={e.item.id}
                    style={styles.row}
                    onPress={() => toggle(appOnlySel, setAppOnlySel, e.item.id)}
                  >
                    {checkBox(appOnlySel.has(e.item.id))}
                    <Text style={styles.rowText}>
                      {cleanName(e.item.name)} · {e.item.id}
                    </Text>
                  </Pressable>
                ))}
            </View>
          )}

          {diff.appOnly.filter((e) => e.wasSynced).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Removed from the sheet</Text>
              <Text style={styles.body}>
                These were synced before, but the row is gone from the sheet. Check to add them
                back to the sheet.
              </Text>
              {diff.appOnly
                .filter((e) => e.wasSynced)
                .map((e) => (
                  <Pressable
                    key={e.item.id}
                    style={styles.row}
                    onPress={() => toggle(appOnlySel, setAppOnlySel, e.item.id)}
                  >
                    {checkBox(appOnlySel.has(e.item.id))}
                    <Text style={styles.rowText}>
                      {cleanName(e.item.name)} · {e.item.id}
                    </Text>
                  </Pressable>
                ))}
            </View>
          )}

          {diff.sheetOnly.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>New in sheet — will be added to the app</Text>
              {diff.sheetOnly.map((r) => (
                <Pressable
                  key={r.row}
                  style={styles.row}
                  onPress={() => toggle(sheetOnlySel, setSheetOnlySel, r.row)}
                >
                  {checkBox(sheetOnlySel.has(r.row))}
                  <Text style={styles.rowText}>
                    {cleanName(r.item)} · sheet row {r.row}
                    {r.appId ? ` · ${r.appId}` : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {diff.changed.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Changed on both sides — pick the winner</Text>
              {diff.changed.map((c) => (
                <View key={c.item.id} style={styles.changedCard}>
                  <Text style={styles.rowText}>
                    {cleanName(c.item.name)} · {c.item.id}
                  </Text>
                  {c.diffs.map((d) => (
                    <Text key={d.field} style={styles.diffLine}>
                      {d.field}: {d.app} → {d.sheet}
                    </Text>
                  ))}
                  <View style={styles.choiceRow}>
                    <Pressable
                      style={[
                        styles.choiceBtn,
                        changedChoice[c.item.id] === 'app' && styles.choiceBtnActive,
                      ]}
                      onPress={() => setChangedChoice({ ...changedChoice, [c.item.id]: 'app' })}
                    >
                      <Text style={styles.choiceText}>Keep app</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.choiceBtn,
                        changedChoice[c.item.id] === 'sheet' && styles.choiceBtnActive,
                      ]}
                      onPress={() => setChangedChoice({ ...changedChoice, [c.item.id]: 'sheet' })}
                    >
                      <Text style={styles.choiceText}>Keep sheet</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          {diff.deletedInApp.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Deleted in app — will be marked Trash in sheet</Text>
              {diff.deletedInApp.map((id) => (
                <Pressable
                  key={id}
                  style={styles.row}
                  onPress={() => toggle(trashSel, setTrashSel, id)}
                >
                  {checkBox(trashSel.has(id))}
                  <Text style={styles.rowText}>{id}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Pressable
            style={[styles.btn, styles.applyBtn, selectedCount() === 0 && styles.disabledBtn]}
            onPress={apply}
            disabled={selectedCount() === 0}
          >
            <Text style={styles.btnText}>Apply selected ({selectedCount()})</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  applyBtn: { backgroundColor: '#1a7f37', marginTop: spacing.lg },
  body: { color: colors.text, fontSize: 15, lineHeight: 21, marginTop: spacing.sm },
  btn: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.md,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  changedCard: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 24,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: '#fff', fontSize: 15, fontWeight: '700' },
  choiceBtn: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  choiceBtnActive: { backgroundColor: colors.chip, borderColor: colors.primary },
  choiceRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  choiceText: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  container: { backgroundColor: colors.background, flex: 1 },
  diffLine: { color: colors.muted, fontSize: 14, lineHeight: 19, marginTop: 2 },
  disabledBtn: { opacity: 0.5 },
  error: { color: '#b42318', fontSize: 15, lineHeight: 21, marginTop: spacing.md },
  meta: { color: colors.muted, fontSize: 14, marginTop: spacing.sm },
  resultCard: {
    backgroundColor: colors.chip,
    borderRadius: radius.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  resultTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: minTouchHeight, paddingVertical: 4 },
  rowText: { color: colors.text, flex: 1, fontSize: 15, lineHeight: 20 },
  section: { marginTop: spacing.lg },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
});
