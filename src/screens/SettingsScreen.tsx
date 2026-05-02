/**
 * SettingsScreen.tsx
 *
 * Ported from the hardware's Settings menu tree:
 * Display (Theme, Font Size, Typeface, Phantom Words, Focus Highlight)
 * and Word Pacing settings.
 */

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBookStore } from '../store/useBookStore';
import { Colors, type ThemeName } from '../theme/colors';
import { FontSizes, type FontSizeLevel, type TypefaceName } from '../theme/fonts';
import { MIN_WPM, MAX_WPM, WPM_STEP } from '../engine/RSVPEngine';

interface Props {
  onBack: () => void;
}

const THEMES: ThemeName[] = ['dark', 'light', 'night'];
const TYPEFACES: TypefaceName[] = ['atkinson', 'opendyslexic', 'standard'];
const FONT_SIZES: FontSizeLevel[] = ['large', 'medium', 'small'];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function SettingsScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const store = useBookStore();
  const colors = Colors[store.theme] || Colors.dark;

  const cycleTheme = () => {
    const idx = THEMES.indexOf(store.theme);
    store.setTheme(THEMES[(idx + 1) % THEMES.length]);
  };

  const cycleTypeface = () => {
    const idx = TYPEFACES.indexOf(store.typeface);
    store.setTypeface(TYPEFACES[(idx + 1) % TYPEFACES.length]);
  };

  const cycleFontSize = () => {
    const idx = FONT_SIZES.indexOf(store.fontSize);
    store.setFontSize(FONT_SIZES[(idx + 1) % FONT_SIZES.length]);
  };

  const adjustWpm = (delta: number) => {
    const next = Math.max(MIN_WPM, Math.min(MAX_WPM, store.wpm + delta * WPM_STEP));
    store.setWpm(next);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={16}>
          <Text style={[styles.headerButton, { color: colors.accent }]}>← Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ── Display ── */}
        <Text style={[styles.sectionTitle, { color: colors.accentDeep }]}>DISPLAY</Text>

        <SettingRow
          label="Theme"
          value={capitalize(store.theme)}
          onPress={cycleTheme}
          colors={colors}
        />
        <SettingRow
          label="Font Size"
          value={capitalize(store.fontSize)}
          onPress={cycleFontSize}
          colors={colors}
        />
        <SettingRow
          label="Typeface"
          value={capitalize(store.typeface)}
          onPress={cycleTypeface}
          colors={colors}
        />
        <SettingRow
          label="Phantom Words"
          value={store.phantomWordsEnabled ? 'On' : 'Off'}
          onPress={() => store.setPhantomWords(!store.phantomWordsEnabled)}
          colors={colors}
        />
        <SettingRow
          label="Focus Highlight"
          value={store.focusHighlightEnabled ? 'On' : 'Off'}
          onPress={() => store.setFocusHighlight(!store.focusHighlightEnabled)}
          colors={colors}
        />

        {/* ── Reading Speed ── */}
        <Text style={[styles.sectionTitle, { color: colors.accentDeep, marginTop: 28 }]}>
          READING SPEED
        </Text>

        <View style={[styles.wpmRow, { borderColor: colors.border }]}>
          <Pressable
            style={[styles.wpmButton, { backgroundColor: colors.surfaceElevated }]}
            onPress={() => adjustWpm(-1)}
          >
            <Text style={[styles.wpmButtonText, { color: colors.accent }]}>−</Text>
          </Pressable>
          <Text style={[styles.wpmValue, { color: colors.textPrimary }]}>
            {store.wpm} WPM
          </Text>
          <Pressable
            style={[styles.wpmButton, { backgroundColor: colors.surfaceElevated }]}
            onPress={() => adjustWpm(1)}
          >
            <Text style={[styles.wpmButtonText, { color: colors.accent }]}>+</Text>
          </Pressable>
        </View>

        {/* ── Pacing ── */}
        <Text style={[styles.sectionTitle, { color: colors.accentDeep, marginTop: 28 }]}>
          WORD PACING
        </Text>

        <PacingSlider
          label="Long Words"
          value={store.longWordDelayMs}
          onDecrease={() =>
            store.setPacingDelays(Math.max(0, store.longWordDelayMs - 25), store.complexWordDelayMs, store.punctuationDelayMs)
          }
          onIncrease={() =>
            store.setPacingDelays(Math.min(600, store.longWordDelayMs + 25), store.complexWordDelayMs, store.punctuationDelayMs)
          }
          colors={colors}
        />
        <PacingSlider
          label="Complexity"
          value={store.complexWordDelayMs}
          onDecrease={() =>
            store.setPacingDelays(store.longWordDelayMs, Math.max(0, store.complexWordDelayMs - 25), store.punctuationDelayMs)
          }
          onIncrease={() =>
            store.setPacingDelays(store.longWordDelayMs, Math.min(600, store.complexWordDelayMs + 25), store.punctuationDelayMs)
          }
          colors={colors}
        />
        <PacingSlider
          label="Punctuation"
          value={store.punctuationDelayMs}
          onDecrease={() =>
            store.setPacingDelays(store.longWordDelayMs, store.complexWordDelayMs, Math.max(0, store.punctuationDelayMs - 25))
          }
          onIncrease={() =>
            store.setPacingDelays(store.longWordDelayMs, store.complexWordDelayMs, Math.min(600, store.punctuationDelayMs + 25))
          }
          colors={colors}
        />

        <Pressable
          style={[styles.resetButton, { borderColor: colors.border }]}
          onPress={() => store.setPacingDelays(200, 200, 200)}
        >
          <Text style={[styles.resetButtonText, { color: colors.accent }]}>Reset Pacing Defaults</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ──────────────────── Sub-Components ────────────────────────────────────────

function SettingRow({
  label, value, onPress, colors,
}: {
  label: string; value: string; onPress: () => void; colors: any;
}) {
  return (
    <Pressable style={[styles.settingRow, { borderColor: colors.border }]} onPress={onPress}>
      <Text style={[styles.settingLabel, { color: colors.textPrimary }]}>{label}</Text>
      <Text style={[styles.settingValue, { color: colors.accent }]}>{value}</Text>
    </Pressable>
  );
}

function PacingSlider({
  label, value, onDecrease, onIncrease, colors,
}: {
  label: string; value: number; onDecrease: () => void; onIncrease: () => void; colors: any;
}) {
  return (
    <View style={[styles.pacingRow, { borderColor: colors.border }]}>
      <Text style={[styles.settingLabel, { color: colors.textPrimary, flex: 1 }]}>{label}</Text>
      <Pressable style={[styles.pacingBtn, { backgroundColor: colors.surfaceElevated }]} onPress={onDecrease}>
        <Text style={[styles.pacingBtnText, { color: colors.accent }]}>−</Text>
      </Pressable>
      <Text style={[styles.pacingValue, { color: colors.textSecondary }]}>{value}ms</Text>
      <Pressable style={[styles.pacingBtn, { backgroundColor: colors.surfaceElevated }]} onPress={onIncrease}>
        <Text style={[styles.pacingBtnText, { color: colors.accent }]}>+</Text>
      </Pressable>
    </View>
  );
}

// ──────────────────── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerButton: { fontSize: 16, fontWeight: '700' },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  content: { paddingHorizontal: 24, paddingBottom: 60 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 12,
    marginTop: 8,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingLabel: { fontSize: 16, fontWeight: '500' },
  settingValue: { fontSize: 15, fontWeight: '700' },
  wpmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  wpmButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wpmButtonText: { fontSize: 24, fontWeight: '700' },
  wpmValue: { fontSize: 22, fontWeight: '800', minWidth: 110, textAlign: 'center' },
  pacingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  pacingBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pacingBtnText: { fontSize: 20, fontWeight: '700' },
  pacingValue: { fontSize: 14, fontWeight: '600', minWidth: 50, textAlign: 'center' },
  resetButton: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  resetButtonText: { fontSize: 15, fontWeight: '700' },
});
