// Sheet sync — two-way, review-first (git-style), driven by one choice:
// which side is the source of truth for this run.
//   App:    the app wins — app items go to the sheet, changed items take
//           the app's version, items deleted in the app are marked Trash
//           in the sheet. Sheet-only rows are left alone.
//   Sheet:  the sheet wins — sheet rows come into the app, changed items
//           take the sheet's version, items deleted in the app are restored
//           from their sheet row. App-only items are left alone.
// "Check for changes" fetches the sheet and shows what will happen under
// the chosen source. Every actionable item starts checked and can be
// unchecked before applying, so nothing happens without approval.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllItems, getDeletedIds, getSettings, getSyncState, clearLocalData } from '../src/lib/db';
import {
  applySync,
  clearSheetOnServer,
  fetchSheetRows,
  overwriteAppFromSheet,
  overwriteSheetFromApp,
  SyncResult,
} from '../src/lib/sync';
import {
  buildPlan,
  computeDiff,
  defaultCheckedKeys,
  planPreview,
  SheetRow,
  SyncDiff,
} from '../src/lib/sync-diff';
import { cleanName } from '../src/lib/listing';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';
import { SyncSource } from '../src/lib/types';

type Phase = 'idle' | 'checking' | 'ready' | 'applying' | 'done' | 'error';

export default function SyncScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const autoCheck = params.auto === '1';
  const autoRan = useRef(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [diff, setDiff] = useState<SyncDiff | null>(null);
  const [sheetRows, setSheetRows] = useState<SheetRow[]>([]);
  const [source, setSource] = useState<SyncSource>('app');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [freshNote, setFreshNote] = useState('');
  const [freshBusy, setFreshBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const s = getSettings();
      setConfigured(!!s.syncUrl.trim() && !!s.syncToken.trim());
      const state = getSyncState();
      setLastSyncAt(state?.at ?? null);
      if (state?.source) setSource(state.source);
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
      setSheetRows(rows);
      setDiff(d);
      const src = getSyncState()?.source ?? source;
      setSource(src);
      setChecked(defaultCheckedKeys(d, src));
      setPhase('ready');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setPhase('error');
    }
  };

  const switchSource = (src: SyncSource) => {
    if (!diff) return;
    setSource(src);
    setChecked(defaultCheckedKeys(diff, src));
  };

  // The banner's "Sync now" opens this screen with ?auto=1 — start the
  // check right away so one tap begins the catch-up.
  useEffect(() => {
    if (autoCheck && !autoRan.current) {
      autoRan.current = true;
      check();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck]);

  const toggle = (key: string) => {
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChecked(next);
  };

  const apply = async () => {
    if (!diff) return;
    setPhase('applying');
    setError('');
    try {
      const r = await applySync(buildPlan(diff, source, checked, sheetRows));
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

  const checkBox = (on: boolean) => (
    <View style={[styles.checkbox, on && styles.checkboxChecked]}>
      {on && <Text style={styles.checkMark}>✓</Text>}
    </View>
  );

  // --- Start fresh: overwrite one side from the other, or clear a side. ---
  // Each one asks for confirmation first. After one runs, the merge diff
  // above is stale, so it is reset — tap "Check for changes" to re-check.
  const resetAfterFresh = () => {
    setDiff(null);
    setPhase('idle');
    setLastSyncAt(getSyncState()?.at ?? null);
  };

  const runFresh = async (
    title: string,
    message: string,
    run: () => Promise<{ count: number; errors: string[] }>,
    done: (r: { count: number; errors: string[] }) => string,
  ) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Do it',
        style: 'destructive',
        onPress: async () => {
          setFreshBusy(true);
          setFreshNote('');
          try {
            const r = await run();
            setFreshNote(done(r) + (r.errors.length > 0 ? ` Errors: ${r.errors.slice(0, 3).join('; ')}` : ''));
          } catch (e) {
            setFreshNote(`Failed: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            resetAfterFresh();
            setFreshBusy(false);
          }
        },
      },
    ]);
  };

  const updateApp = () => {
    const n = diff ? diff.sheetOnly.length + diff.changed.length + diff.deletedInApp.length : null;
    runFresh(
      'Update app from sheet?',
      `This replaces everything in the app with the sheet's ${getSettings().syncSheet || 'Inventory'} rows${n !== null ? ` (about ${n} rows differ right now)` : ''}. Items only in the app will be lost. The sheet is not changed.`,
      overwriteAppFromSheet,
      (r) => `App updated from the sheet: ${r.count} items imported.`,
    );
  };

  const updateSheet = () => {
    const n = getAllItems().length;
    runFresh(
      'Update sheet from app?',
      `This replaces the sheet's ${getSettings().syncSheet || 'Inventory'} rows with the app's ${n} items. Rows only in the sheet will be lost. The app is not changed.`,
      overwriteSheetFromApp,
      (r) => `Sheet updated from the app: ${r.count} rows written.`,
    );
  };

  const clearApp = () => {
    runFresh(
      'Clear the app?',
      'This empties the app — items and their photos, Free items, Expenses, and sync history. Settings are kept, and the sheet is not touched. Use “Update app from sheet” afterwards to fill it again.',
      async () => {
        clearLocalData();
        return { count: 0, errors: [] };
      },
      () => 'App cleared — it is empty now.',
    );
  };

  const clearSheet = () => {
    runFresh(
      'Clear the sheet?',
      `This deletes all data rows from the sheet's ${getSettings().syncSheet || 'Inventory'} tab (the header stays). The app is not touched.`,
      clearSheetOnServer,
      (r) => `Sheet cleared: ${r.count} rows deleted.`,
    );
  };

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

  const groups = diff ? planPreview(diff, source) : [];
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
        Pick which side is the source of truth, review what will happen, then apply. Nothing is
        written until you tap Apply.
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
          <Text style={styles.body}>Restored to app: {result.restoredToApp}</Text>
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
          <Text style={styles.sectionTitle}>Source of truth</Text>
          <View style={styles.sourceRow}>
            <Pressable
              style={[styles.sourceBtn, source === 'app' && styles.sourceBtnActive]}
              onPress={() => switchSource('app')}
            >
              <Text style={styles.sourceTitle}>App</Text>
              <Text style={styles.sourceDesc}>App wins — app items go to the sheet.</Text>
            </Pressable>
            <Pressable
              style={[styles.sourceBtn, source === 'sheet' && styles.sourceBtnActive]}
              onPress={() => switchSource('sheet')}
            >
              <Text style={styles.sourceTitle}>Sheet</Text>
              <Text style={styles.sourceDesc}>Sheet wins — sheet rows come to the app.</Text>
            </Pressable>
          </View>

          {groups.map((g) => (
            <View key={g.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{g.title}</Text>
              {!!g.note && <Text style={styles.body}>{g.note}</Text>}
              {g.items.map((it) => (
                <Pressable
                  key={it.key}
                  style={styles.row}
                  onPress={g.actionable ? () => toggle(it.key) : undefined}
                  disabled={!g.actionable}
                >
                  {g.actionable ? (
                    checkBox(checked.has(it.key))
                  ) : (
                    <View style={styles.checkboxDisabled}>
                      <Text style={styles.checkMarkDisabled}>–</Text>
                    </View>
                  )}
                  <View style={styles.rowTextWrap}>
                    <Text style={[styles.rowText, !g.actionable && styles.rowTextMuted]}>
                      {cleanName(it.label)}
                    </Text>
                    {!!it.sub && (
                      <Text style={[styles.rowSub, !g.actionable && styles.rowTextMuted]}>
                        {it.sub}
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          ))}

          <Pressable
            style={[styles.btn, styles.applyBtn, checked.size === 0 && styles.disabledBtn]}
            onPress={apply}
            disabled={checked.size === 0}
          >
            <Text style={styles.btnText}>Apply selected ({checked.size})</Text>
          </Pressable>
        </>
      )}

      <View style={styles.freshSection}>
        <Text style={styles.sectionTitle}>Start fresh</Text>
        <Text style={styles.body}>
          Overwrite one side from the other, or clear a side entirely. Each one asks first — the
          merge sync above is still the safe default.
        </Text>
        <Pressable
          style={[styles.btn, styles.freshBtn, freshBusy && styles.disabledBtn]}
          onPress={updateApp}
          disabled={freshBusy || phase === 'checking' || phase === 'applying'}
        >
          <Text style={styles.btnText}>Update app from sheet</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.freshBtn, freshBusy && styles.disabledBtn]}
          onPress={updateSheet}
          disabled={freshBusy || phase === 'checking' || phase === 'applying'}
        >
          <Text style={styles.btnText}>Update sheet from app</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.dangerBtn, freshBusy && styles.disabledBtn]}
          onPress={clearApp}
          disabled={freshBusy || phase === 'checking' || phase === 'applying'}
        >
          <Text style={styles.btnText}>Clear app</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.dangerBtn, freshBusy && styles.disabledBtn]}
          onPress={clearSheet}
          disabled={freshBusy || phase === 'checking' || phase === 'applying'}
        >
          <Text style={styles.btnText}>Clear sheet</Text>
        </Pressable>
        {!!freshNote && <Text style={styles.body}>{freshNote}</Text>}
      </View>
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
  checkboxDisabled: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 24,
  },
  checkMark: { color: '#fff', fontSize: 15, fontWeight: '700' },
  checkMarkDisabled: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  container: { backgroundColor: colors.background, flex: 1 },
  dangerBtn: { backgroundColor: '#b42318' },
  disabledBtn: { opacity: 0.5 },
  error: { color: '#b42318', fontSize: 15, lineHeight: 21, marginTop: spacing.md },
  freshBtn: { backgroundColor: '#57606a' },
  freshSection: { borderTopColor: colors.border, borderTopWidth: 1, marginTop: spacing.xl, paddingTop: spacing.md },
  meta: { color: colors.muted, fontSize: 14, marginTop: spacing.sm },
  resultCard: {
    backgroundColor: colors.chip,
    borderRadius: radius.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  resultTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: minTouchHeight, paddingVertical: 4 },
  rowSub: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  rowText: { color: colors.text, fontSize: 15, lineHeight: 20 },
  rowTextMuted: { color: colors.muted },
  rowTextWrap: { flex: 1 },
  section: { marginTop: spacing.lg },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sourceBtn: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md,
  },
  sourceBtnActive: { backgroundColor: colors.chip, borderColor: colors.primary },
  sourceDesc: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  sourceRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  sourceTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
});
