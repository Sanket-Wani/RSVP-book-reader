/**
 * App.tsx — RSVP Nano Mobile
 *
 * Root component that handles:
 * - Font loading with splash screen hold
 * - Simple stack-like navigation between Library → Reader → Settings
 * - Safe area context wrapping
 * - Status bar configuration
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';

import LibraryScreen from './src/screens/LibraryScreen';
import RSVPReaderScreen from './src/screens/RSVPReaderScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { CustomFontAssets } from './src/theme/fonts';
import { useBookStore } from './src/store/useBookStore';
import type { BookContent } from './src/engine/RSVPEngine';

// Keep the splash screen visible while fonts load
SplashScreen.preventAutoHideAsync();

type Screen = 'library' | 'reader' | 'settings';

interface ReaderState {
  bookId: string;
  book: BookContent;
}

export default function App() {
  const theme = useBookStore((s) => s.theme);
  const [currentScreen, setCurrentScreen] = useState<Screen>('library');
  const [readerState, setReaderState] = useState<ReaderState | null>(null);

  const [fontsLoaded, fontError] = useFonts(CustomFontAssets);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  const handleOpenBook = useCallback((bookId: string, book: BookContent) => {
    setReaderState({ bookId, book });
    setCurrentScreen('reader');
  }, []);

  const handleBackToLibrary = useCallback(() => {
    setCurrentScreen('library');
  }, []);

  const handleOpenSettings = useCallback(() => {
    setCurrentScreen('settings');
  }, []);

  const handleBackFromSettings = useCallback(() => {
    setCurrentScreen('library');
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  const statusBarStyle = theme === 'light' ? 'dark' : 'light';

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style={statusBarStyle} />
        {currentScreen === 'library' && (
          <LibraryScreen onOpenBook={handleOpenBook} onOpenSettings={handleOpenSettings} />
        )}
        {currentScreen === 'reader' && readerState && (
          <RSVPReaderScreen
            book={readerState.book}
            bookId={readerState.bookId}
            onBack={handleBackToLibrary}
          />
        )}
        {currentScreen === 'settings' && (
          <SettingsScreen onBack={handleBackFromSettings} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
