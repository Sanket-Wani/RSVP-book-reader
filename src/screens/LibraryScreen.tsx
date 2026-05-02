/**
 * LibraryScreen.tsx
 *
 * The home screen showing the user's imported book library.
 * Provides buttons to import new books, manage settings, and resume reading.
 * Styled to match the warm RSVP Nano web page aesthetic.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pickAndImportBook, ImportError } from '../services/ImportService';
import { useBookStore, type LibraryEntry } from '../store/useBookStore';
import { Colors, type ThemeName } from '../theme/colors';
import type { BookContent } from '../engine/RSVPEngine';

interface Props {
  onOpenBook: (bookId: string, book: BookContent) => void;
  onOpenSettings: () => void;
}

export default function LibraryScreen({ onOpenBook, onOpenSettings }: Props) {
  const insets = useSafeAreaInsets();
  const store = useBookStore();
  const colors = Colors[store.theme] || Colors.dark;

  const [isImporting, setIsImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const handleImport = useCallback(async () => {
    setIsImporting(true);
    setStatusMessage('Selecting file...');

    try {
      const book = await pickAndImportBook();
      if (!book) {
        setStatusMessage('');
        setIsImporting(false);
        return;
      }

      setStatusMessage(`Converting "${book.title}"...`);

      const id = store.addBook(book);
      store.setActiveBook(id, book);
      setStatusMessage('');
      setIsImporting(false);
      onOpenBook(id, book);
    } catch (err) {
      setIsImporting(false);
      const msg = err instanceof ImportError ? err.message : 'Failed to import file.';
      setStatusMessage('');
      Alert.alert('Import Error', msg);
    }
  }, [store, onOpenBook]);

  const handleOpenBook = useCallback(async (entry: LibraryEntry) => {
    console.log('[Library] Opening book:', entry.id);
    // 1. Check if we have the book content in memory or persisted data map
    let book = store.activeBook && store.activeBookId === entry.id ? store.activeBook : null;
    
    if (!book) {
      book = (store.bookDataMap || {})[entry.id];
      console.log('[Library] Loaded book from data map:', !!book);
    }

    if (book) {
      store.setActiveBook(entry.id, book);
      onOpenBook(entry.id, book);
      return;
    }

    // 2. Fallback: if data is somehow missing, we need the user to re-import
    console.log('[Library] Book data missing for:', entry.id);
    const title = 'Book Data Missing';
    const message = `The content for "${entry.title}" is missing from storage.\n\nWould you like to re-import the file?`;

    if (Platform.OS === 'web') {
      // Browser might block window.confirm, so just trigger import
      console.warn(message);
      handleImport();
    } else {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Import', onPress: handleImport },
      ]);
    }
  }, [store.activeBook, store.activeBookId, store.bookDataMap, store.setActiveBook, handleImport, onOpenBook]);

  const handleResetProgress = useCallback((entry: LibraryEntry) => {
    console.log('[Library] Resetting progress for:', entry.id);
    const title = 'Reset Progress';
    const message = `Reset reading progress for "${entry.title}" to the beginning?`;

    const performReset = () => {
      console.log('[Library] Performing reset...');
      store.resetProgress(entry.id);
    };

    if (Platform.OS === 'web') {
      // Browser might block window.confirm, so just execute
      performReset();
    } else {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: performReset },
      ]);
    }
  }, [store]);

  const handleRemoveBook = useCallback((entry: LibraryEntry) => {
    console.log('[Library] Removing book:', entry.id);
    const title = 'Remove Book';
    const message = `Permanently delete "${entry.title}"? Reading progress and content will be removed.`;

    const performRemove = () => {
      console.log('[Library] Performing remove...');
      store.removeBook(entry.id);
    };

    if (Platform.OS === 'web') {
      // Browser might block window.confirm, so just execute
      performRemove();
    } else {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: performRemove },
      ]);
    }
  }, [store]);

  const renderItem = useCallback(
    ({ item }: { item: LibraryEntry }) => {
      const progress = store.getProgress(item.id);
      const pct = progress && item.wordCount > 0
        ? Math.round((progress.wordIndex / (item.wordCount - 1)) * 100)
        : 0;

      return (
        <View
          style={[styles.bookCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Pressable
            onPress={() => handleOpenBook(item)}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={styles.bookCardHeader}>
              <Text style={[styles.bookTitle, { color: colors.textPrimary }]} numberOfLines={2}>
                {item.title}
              </Text>
              {pct > 0 && (
                <View style={[styles.progressPill, { backgroundColor: colors.cardGlow }]}>
                  <Text style={[styles.progressPillText, { color: colors.accent }]}>{pct}%</Text>
                </View>
              )}
            </View>

            {item.author ? (
              <Text style={[styles.bookAuthor, { color: colors.textSecondary }]} numberOfLines={1}>
                {item.author}
              </Text>
            ) : null}

            <View style={styles.bookMeta}>
              <View style={[styles.pill, { backgroundColor: colors.cardGlow }]}>
                <Text style={[styles.pillText, { color: colors.accentDeep }]}>
                  {item.wordCount.toLocaleString()} words
                </Text>
              </View>
              <View style={[styles.pill, { backgroundColor: colors.cardGlow }]}>
                <Text style={[styles.pillText, { color: colors.accentDeep }]}>
                  {item.chapterCount} {item.chapterCount === 1 ? 'chapter' : 'chapters'}
                </Text>
              </View>
            </View>

            {pct > 0 && (
              <View style={[styles.miniProgress, { backgroundColor: colors.progressTrack }]}>
                <View
                  style={[styles.miniProgressFill, { backgroundColor: colors.progressFill, width: `${pct}%` }]}
                />
              </View>
            )}
          </Pressable>

          {/* Action Buttons Area */}
          <View style={styles.cardActions}>
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                { borderColor: colors.border, opacity: pressed ? 0.5 : 1 }
              ]}
              onPress={() => handleResetProgress(item)}
              hitSlop={12}
            >
              <Text style={[styles.actionBtnText, { color: colors.textSecondary }]}>Reset</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                { borderColor: colors.border, opacity: pressed ? 0.5 : 1 }
              ]}
              onPress={() => handleRemoveBook(item)}
              hitSlop={12}
            >
              <Text style={[styles.actionBtnText, { color: colors.error ?? '#ff4444' }]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      );
    },
    [colors, store, handleOpenBook, handleRemoveBook],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.accentDeep }]}>RSVP READER</Text>
          <Text style={[styles.heroTitle, { color: colors.textPrimary }]}>Library</Text>
        </View>
        <Pressable
          onPress={onOpenSettings}
          style={[styles.settingsButton, { borderColor: colors.border }]}
          hitSlop={8}
        >
          <Text style={[styles.settingsIcon, { color: colors.textSecondary }]}>⚙</Text>
        </Pressable>
      </View>

      {/* ── Import Button ── */}
      <View style={styles.importSection}>
        <Pressable
          style={[styles.importButton, { backgroundColor: colors.accent }]}
          onPress={handleImport}
          disabled={isImporting}
        >
          {isImporting ? (
            <ActivityIndicator color="#fffaf1" size="small" />
          ) : (
            <Text style={styles.importButtonText}>Import Book</Text>
          )}
        </Pressable>
        <Text style={[styles.importHint, { color: colors.textSecondary }]}>
          EPUB, TXT, Markdown, or HTML
        </Text>
        {statusMessage ? (
          <Text style={[styles.statusText, { color: colors.accent }]}>{statusMessage}</Text>
        ) : null}
      </View>

      {/* ── Book List ── */}
      {store.library.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyIcon, { color: colors.textDim }]}>📖</Text>
          <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
            Your library is empty
          </Text>
          <Text style={[styles.emptyBody, { color: colors.textDim }]}>
            Import a book to start speed reading one word at a time.
          </Text>
        </View>
      ) : (
        <FlatList
          data={store.library}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1.5,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  settingsIcon: {
    fontSize: 20,
  },
  importSection: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    alignItems: 'center',
  },
  importButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    shadowColor: '#d3542f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  importButtonText: {
    color: '#fffaf1',
    fontSize: 17,
    fontWeight: '800',
  },
  importHint: {
    fontSize: 13,
    marginTop: 10,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  bookCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    marginBottom: 14,
  },
  bookCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  bookTitle: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    lineHeight: 24,
  },
  progressPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
  progressPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  bookAuthor: {
    fontSize: 14,
    marginTop: 4,
  },
  bookMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  miniProgress: {
    height: 3,
    borderRadius: 1.5,
    marginTop: 14,
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
});
