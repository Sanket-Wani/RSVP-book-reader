/**
 * useBookStore.ts
 *
 * Zustand store replacing ESP32 Preferences (NVS) for persisting:
 * - Current book, reading position, WPM
 * - Library of imported books
 * - Theme and typography preferences
 *
 * Uses AsyncStorage for persistence.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BookContent } from '../engine/RSVPEngine';
import type { ThemeName } from '../theme/colors';
import type { TypefaceName, FontSizeLevel } from '../theme/fonts';

// ──────────────────── Types ─────────────────────────────────────────────────

export interface LibraryEntry {
  id: string;
  title: string;
  author: string;
  wordCount: number;
  chapterCount: number;
  importedAt: number; // timestamp
}

export interface ReadingProgress {
  bookId: string;
  wordIndex: number;
  wpm: number;
  lastReadAt: number;
}

interface BookStoreState {
  // ── Library ──
  library: LibraryEntry[];
  bookDataMap: Record<string, BookContent>; // Now persisted!
  activeBookId: string | null;
  activeBook: BookContent | null; // Keep in memory for fast access

  // ── Reading Progress (persisted per-book) ──
  progressMap: Record<string, ReadingProgress>;

  // ── Settings ──
  wpm: number;
  theme: ThemeName;
  typeface: TypefaceName;
  fontSize: FontSizeLevel;
  phantomWordsEnabled: boolean;
  focusHighlightEnabled: boolean;
  longWordDelayMs: number;
  complexWordDelayMs: number;
  punctuationDelayMs: number;

  // ── Actions ──
  addBook: (book: BookContent) => string;
  setActiveBook: (id: string, book: BookContent) => void;
  clearActiveBook: () => void;
  removeBook: (id: string) => void;

  saveProgress: (bookId: string, wordIndex: number, wpm: number) => void;
  resetProgress: (bookId: string) => void;
  getProgress: (bookId: string) => ReadingProgress | null;

  setWpm: (wpm: number) => void;
  setTheme: (theme: ThemeName) => void;
  setTypeface: (typeface: TypefaceName) => void;
  setFontSize: (size: FontSizeLevel) => void;
  setPhantomWords: (enabled: boolean) => void;
  setFocusHighlight: (enabled: boolean) => void;
  setPacingDelays: (long: number, complex: number, punctuation: number) => void;
}

// ──────────────────── Store ─────────────────────────────────────────────────

export const useBookStore = create<BookStoreState>()(
  persist(
    (set, get) => ({
      // ── Initial State ──
      library: [],
      bookDataMap: {},
      activeBookId: null,
      activeBook: null,
      progressMap: {},

      wpm: 300,
      theme: 'dark',
      typeface: 'standard',
      fontSize: 'medium',
      phantomWordsEnabled: true,
      focusHighlightEnabled: true,
      longWordDelayMs: 250,
      complexWordDelayMs: 300,
      punctuationDelayMs: 400,

      // ── Actions ──
      addBook: (book) => {
        const id = `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const entry: LibraryEntry = {
          id,
          title: book.title,
          author: book.author,
          wordCount: book.words.length,
          chapterCount: book.chapters.length,
          importedAt: Date.now(),
        };
        set((s) => ({
          library: [...s.library, entry],
          bookDataMap: { ...s.bookDataMap, [id]: book },
        }));
        return id;
      },

      setActiveBook: (id, book) => {
        set({ activeBookId: id, activeBook: book });
      },

      clearActiveBook: () => {
        set({ activeBookId: null, activeBook: null });
      },

      removeBook: (id) => {
        set((s) => {
          const { [id]: _, ...remainingData } = s.bookDataMap || {};
          const { [id]: __, ...remainingProgress } = s.progressMap || {};
          
          return {
            library: s.library ? s.library.filter((e) => e.id !== id) : [],
            bookDataMap: remainingData,
            progressMap: remainingProgress,
            activeBookId: s.activeBookId === id ? null : s.activeBookId,
            activeBook: s.activeBookId === id ? null : s.activeBook,
          };
        });
      },

      saveProgress: (bookId, wordIndex, wpm) => {
        set((s) => ({
          progressMap: {
            ...(s.progressMap || {}),
            [bookId]: {
              bookId,
              wordIndex,
              wpm,
              lastReadAt: Date.now(),
            },
          },
        }));
      },

      resetProgress: (bookId) => {
        set((s) => {
          const newMap = { ...(s.progressMap || {}) };
          delete newMap[bookId];
          return { progressMap: newMap };
        });
      },

      getProgress: (bookId) => {
        return (get().progressMap || {})[bookId] ?? null;
      },

      setWpm: (wpm) => set({ wpm }),
      setTheme: (theme) => set({ theme }),
      setTypeface: (typeface) => set({ typeface }),
      setFontSize: (fontSize) => set({ fontSize }),
      setPhantomWords: (enabled) => set({ phantomWordsEnabled: enabled }),
      setFocusHighlight: (enabled) => set({ focusHighlightEnabled: enabled }),
      setPacingDelays: (long, complex, punctuation) =>
        set({
          longWordDelayMs: long,
          complexWordDelayMs: complex,
          punctuationDelayMs: punctuation,
        }),
    }),
    {
      name: 'rsvp-nano-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Don't persist the active book content (it's huge)
      partialize: (state) => ({
        library: state.library,
        bookDataMap: state.bookDataMap, // Now persisted!
        activeBookId: state.activeBookId,
        progressMap: state.progressMap,
        wpm: state.wpm,
        theme: state.theme,
        typeface: state.typeface,
        fontSize: state.fontSize,
        phantomWordsEnabled: state.phantomWordsEnabled,
        focusHighlightEnabled: state.focusHighlightEnabled,
        longWordDelayMs: state.longWordDelayMs,
        complexWordDelayMs: state.complexWordDelayMs,
        punctuationDelayMs: state.punctuationDelayMs,
      }),
    },
  ),
);
