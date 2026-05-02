/**
 * RSVPReaderScreen.tsx
 *
 * The core reading experience â€” ported from the hardware's DisplayManager
 * and App.cpp reader state machine.
 *
 * Features:
 *  - Focus letter highlighted in red (split-span technique, web + mobile)
 *  - Phantom words at low opacity on either side
 *  - Play/Pause via tap, hold-to-read, double-tap lock
 *  - WPM adjustment via scroll wheel on web, swipe up/down on mobile
 *  - Animated progress bar (Reanimated, 60fps)
 *  - Sentence-boundary pause
 *  - Chapter tracking
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  FlatList,
  Vibration,
  Dimensions,
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { RSVPController, focusLetterIndex } from '../engine/RSVPEngine';
import { useBookStore } from '../store/useBookStore';
import { Colors } from '../theme/colors';
import { FontFamilies, FontSizes } from '../theme/fonts';
import type { BookContent, ChapterMarker } from '../engine/RSVPEngine';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SAVE_INTERVAL_MS = 5000;
const WPM_FEEDBACK_DURATION_MS = 1500;
const DOUBLE_TAP_THRESHOLD_MS = 350;

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Props â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface Props {
  book: BookContent;
  bookId: string;
  onBack: () => void;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function RSVPReaderScreen({ book, bookId, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const store = useBookStore();
  const colors = Colors[store.theme] || Colors.dark;
  const fontFamily = FontFamilies[store.typeface] || FontFamilies.standard;
  const fontSize = FontSizes[store.fontSize] || FontSizes.medium;

  // â”€â”€ Engine â”€â”€
  const engineRef = useRef(new RSVPController());
  const engine = engineRef.current;

  // â”€â”€ State â”€â”€
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [displayWord, setDisplayWord] = useState('');
  const [phantomBefore, setPhantomBefore] = useState('');
  const [phantomAfter, setPhantomAfter] = useState('');
  const [wpmDisplay, setWpmDisplay] = useState(store.wpm);
  const [wpmFeedbackVisible, setWpmFeedbackVisible] = useState(false);
  const [chapterLabel, setChapterLabel] = useState('');
  const [isTocOpen, setIsTocOpen] = useState(false);

  // â”€â”€ Refs â”€â”€
  const playingRef = useRef(false);
  const lockedRef = useRef(false);
  const pauseAtSentenceEndRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wpmFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordsSinceStartRef = useRef(0);
  const lastHapticWpmRef = useRef(Math.floor(store.wpm / 50));
  const clickSoundRef = useRef<Audio.Sound | null>(null);

  // ── Immersive Canvas Layout ──
  const paraLayouts = useRef(new Map<number, { y: number }>());
  const wordLayouts = useRef(new Map<number, { x: number, y: number, w: number, h: number }>());
  const [activeWordStr, setActiveWordStr] = useState(engine.currentWord);
  const [activeIndex, setActiveIndex] = useState(engine.currentIndex);
  const [progress, setProgress] = useState(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const canvasOpacity = useSharedValue(0);

  const getParagraphIndex = useCallback((wordIdx: number) => {
    const starts = book.paragraphStarts || [0];
    let idx = 0;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= wordIdx) idx = i;
      else break;
    }
    return idx;
  }, [book.paragraphStarts]);

  const pages = useMemo(() => {
    const chunks: number[][] = [];
    let currentChunkParas: number[] = [];
    let currentWordCount = 0;
    const starts = book.paragraphStarts || [0];
    
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const end = starts[i+1] || book.words.length;
      const wordCount = end - start;
      
      currentChunkParas.push(i);
      currentWordCount += wordCount;
      
      if (currentWordCount > 600) {
        chunks.push(currentChunkParas);
        currentChunkParas = [];
        currentWordCount = 0;
      }
    }
    if (currentChunkParas.length > 0) chunks.push(currentChunkParas);
    return chunks.length > 0 ? chunks : [[0]];
  }, [book.paragraphStarts, book.words.length]);

  const currentPageIndex = useMemo(() => {
    const paraIdx = getParagraphIndex(engine.currentIndex);
    const pageIdx = pages.findIndex(pageParas => pageParas.includes(paraIdx));
    return pageIdx >= 0 ? pageIdx : 0;
  }, [engine.currentIndex, pages, getParagraphIndex]);

  useEffect(() => {
    canvasOpacity.value = 0;
  }, [currentPageIndex]);

  const updateCamera = useCallback((wordIdx: number, duration: number) => {
    const wordL = wordLayouts.current.get(wordIdx);
    const paraIdx = getParagraphIndex(wordIdx);
    const paraL = paraLayouts.current.get(paraIdx);
    
    if (wordL && paraL) {
      const absX = wordL.x;
      const absY = paraL.y + wordL.y;
      
      const wordStr = book.words[wordIdx] || '';
      const focusIdx = focusLetterIndex(wordStr);
      // Add 0.5 to center on the middle of the pivot character itself, rather than its left edge
      const orpRatio = wordStr.length > 0 ? (focusIdx + 0.5) / wordStr.length : 0.5;
      
      const canvasMargin = SCREEN_WIDTH * 0.05;
      const wordWidth = wordL.w - (fontSize * 0.3); // subtract approximate space width
      
      // Center the word on the red pivot character
      const orpX = canvasMargin + absX + (wordWidth * orpRatio);
      const orpY = absY + (wordL.h / 2);
      
      const targetX = (SCREEN_WIDTH / 2) - orpX;
      
      // Vertically center exactly to the screen, accounting for safe area and header (~48px)
      const readerAreaTop = insets.top + 48; 
      const targetY = (SCREEN_HEIGHT / 2) - readerAreaTop - orpY;
      
      translateX.value = targetX;
      translateY.value = targetY;
      canvasOpacity.value = 1;
    }
  }, [getParagraphIndex, book.words, translateX, translateY, canvasOpacity]);

  const saveParaLayout = useCallback((pIdx: number, y: number) => {
    paraLayouts.current.set(pIdx, { y });
  }, []);

  const saveWordLayout = useCallback((absIndex: number, x: number, y: number, w: number, h: number) => {
    wordLayouts.current.set(absIndex, { x, y, w, h });
    if (absIndex === engine.currentIndex) {
      updateCamera(engine.currentIndex, 0);
    }
  }, [engine.currentIndex, updateCamera]);

  // â”€â”€ Animated values â”€â”€
  const progressAnim = useSharedValue(0);
  const wordOpacity = useSharedValue(1);

  const animatedProgressStyle = useAnimatedStyle(() => ({
    width: `${Math.min(100, progressAnim.value)}%`,
  }));

  const animatedCanvasStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value }
    ],
    opacity: canvasOpacity.value
  }));

  // â”€â”€ Initialize engine â”€â”€
  useEffect(() => {
    engine.setWords(book.words);
    engine.setWpm(store.wpm);
    engine.setPacingConfig({
      longWordDelayMs: store.longWordDelayMs,
      complexWordDelayMs: store.complexWordDelayMs,
      punctuationDelayMs: store.punctuationDelayMs,
    });

    const progress = store.getProgress(bookId);
    if (progress) {
      engine.seekTo(progress.wordIndex);
      engine.setWpm(progress.wpm);
      setWpmDisplay(progress.wpm);
    }

    updateDisplay();

    saveTimerRef.current = setInterval(() => {
      store.saveProgress(bookId, engine.currentIndex, engine.wpm);
    }, SAVE_INTERVAL_MS);

    return () => {
      store.saveProgress(bookId, engine.currentIndex, engine.wpm);
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (wpmFeedbackTimerRef.current) clearTimeout(wpmFeedbackTimerRef.current);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // â”€â”€ Display Update â”€â”€
  const updateDisplay = useCallback(() => {
    setWpmDisplay(engine.wpm);
    setProgress(engine.currentIndex / Math.max(1, engine.wordCount - 1));
    setActiveWordStr(engine.currentWord);
    setActiveIndex(engine.currentIndex);
    updateCamera(engine.currentIndex, playingRef.current ? engine.currentWordDurationMs() : 0);

    const pct = engine.wordCount > 0
      ? (engine.currentIndex / (engine.wordCount - 1)) * 100
      : 0;
    progressAnim.value = withTiming(pct, { duration: 150, easing: Easing.out(Easing.quad) });

    const chapter = findCurrentChapter(book.chapters, engine.currentIndex);
    if (chapter) setChapterLabel(chapter.title);
  }, [engine, book.chapters, progressAnim, updateCamera]);

  // â”€â”€ Sound Feedback â”€â”€
  useEffect(() => {
    let isMounted = true;
    const loadSound = async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(
          // Using a subtle mechanical click sound
          { uri: 'https://www.soundjay.com/communication/mechanical-clic-1.mp3' }
        );
        if (isMounted) {
          clickSoundRef.current = sound;
          await sound.setVolumeAsync(0.3); // Keep it subtle
        }
      } catch (err) {
        console.warn('Failed to load click sound', err);
      }
    };
    loadSound();
    return () => {
      isMounted = false;
      if (clickSoundRef.current) {
        clickSoundRef.current.unloadAsync();
      }
    };
  }, []);

  const playClickSound = useCallback(async () => {
    if (clickSoundRef.current) {
      try {
        await clickSoundRef.current.replayAsync();
      } catch (err) {
        // Ignore play errors during rapid scrolling
      }
    }
  }, []);

  const playClickSoundRef = useRef(playClickSound);
  playClickSoundRef.current = playClickSound;
  const scheduleNextWord = useCallback(() => {
    if (!playingRef.current) return;

    let dur = engine.currentWordDurationMs();

    // Gentle acceleration curve for the first 5 words
    const wordsPlayed = wordsSinceStartRef.current;
    if (wordsPlayed < 5) {
      // Multipliers: 2.5x, 2.0x, 1.6x, 1.3x, 1.1x -> then 1.0x
      const multipliers = [2.5, 2.0, 1.6, 1.3, 1.1];
      dur = dur * multipliers[wordsPlayed];
    }

    timerRef.current = setTimeout(() => {
      if (!playingRef.current) return;

      if (pauseAtSentenceEndRef.current && engine.currentWordEndsSentence()) {
        pauseAtSentenceEndRef.current = false;
        playingRef.current = false;
        lockedRef.current = false;
        setIsPlaying(false);
        setIsLocked(false);
        updateDisplay();
        return;
      }

      engine.scrub(1);
      wordsSinceStartRef.current += 1;
      updateDisplay();

      if (engine.atEnd) {
        playingRef.current = false;
        setIsPlaying(false);
        setIsLocked(false);
        return;
      }

      scheduleNextWord();
    }, dur);
  }, [engine, updateDisplay]);

  const startPlaying = useCallback(() => {
    playingRef.current = true;
    pauseAtSentenceEndRef.current = false;
    wordsSinceStartRef.current = 0; // Reset acceleration curve
    setIsPlaying(true);
    engine.start(Date.now());
    scheduleNextWord();
  }, [engine, scheduleNextWord]);

  const stopPlaying = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    playingRef.current = false;
    lockedRef.current = false;
    pauseAtSentenceEndRef.current = false;
    setIsPlaying(false);
    setIsLocked(false);
  }, []);

  // â”€â”€ WPM Adjust â”€â”€
  const adjustWpm = useCallback((delta: number) => {
    engine.adjustWpm(delta);
    setWpmDisplay(engine.wpm);
    store.setWpm(engine.wpm);
    setWpmFeedbackVisible(true);

    // Provide "knob" feedback for every 50 WPM boundary
    const currentStep = Math.floor(engine.wpm / 50);
    if (currentStep !== lastHapticWpmRef.current) {
      runOnJS(playClickSoundRef.current)();
      lastHapticWpmRef.current = currentStep;
    }

    if (wpmFeedbackTimerRef.current) clearTimeout(wpmFeedbackTimerRef.current);
    wpmFeedbackTimerRef.current = setTimeout(
      () => setWpmFeedbackVisible(false),
      WPM_FEEDBACK_DURATION_MS
    );
  }, [engine, store]);

  // â”€â”€ Web Scroll Wheel for WPM â”€â”€
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Scroll up = faster (+), scroll down = slower (-)
      const delta = e.deltaY < 0 ? 10 : -10;
      adjustWpm(delta);
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [adjustWpm]);

  const handleBeginTouch = useCallback(() => {
    if (lockedRef.current) return;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      startPlaying(); // Start natural pacing after 800ms hold
    }, 800); 
  }, [startPlaying]);

  const handleCancelTouch = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (playingRef.current) {
      stopPlaying(); // Force immediate engine halt
    }
  }, [stopPlaying]);

  const handleBeginTouchRef = useRef(handleBeginTouch);
  handleBeginTouchRef.current = handleBeginTouch;
  const handleCancelTouchRef = useRef(handleCancelTouch);
  handleCancelTouchRef.current = handleCancelTouch;

  // â”€â”€ Gestures â”€â”€
  const stopPlayingRef = useRef(stopPlaying);
  stopPlayingRef.current = stopPlaying;
  const startPlayingRef = useRef(startPlaying);
  startPlayingRef.current = startPlaying;

  const stopIfPlaying = useCallback(() => {
    if (playingRef.current) stopPlaying();
  }, [stopPlaying]);
  const stopIfPlayingRef = useRef(stopIfPlaying);
  stopIfPlayingRef.current = stopIfPlaying;

  const handleTapLock = useCallback(() => {
    lockedRef.current = !lockedRef.current;
    setIsLocked(lockedRef.current);
    if (lockedRef.current) {
      startPlaying();
    } else {
      stopPlaying();
    }
  }, [startPlaying, stopPlaying]);

  const handleTapLockRef = useRef(handleTapLock);
  handleTapLockRef.current = handleTapLock;

  const adjustWpmRef = useRef(adjustWpm);
  adjustWpmRef.current = adjustWpm;

  const accumulatedWpmDelta = useRef(0);

  // The Pan gesture will now handle BOTH "Hold to read" and "Swipe to adjust"
  const panGesture = useMemo(() => Gesture.Pan()
    .manualActivation(false)
    .onBegin(() => {
      runOnJS(handleBeginTouchRef.current)();
    })
    .onStart(() => {
      runOnJS(handleCancelTouchRef.current)();
    })
    .onUpdate((e) => {
      runOnJS(handleCancelTouchRef.current)();

      // Only handle vertical movement for speed
      if (Math.abs(e.translationY) > Math.abs(e.translationX)) {
        const delta = -e.translationY - accumulatedWpmDelta.current;
        if (Math.abs(delta) >= 3) {
          const steps = Math.trunc(delta / 3);
          runOnJS(adjustWpmRef.current)(steps * 10); // Still adjust in increments of 10 WPM
          accumulatedWpmDelta.current += steps * 3;
        }
      }
      // Horizontal movement is explicitly ignored
    })
    .onFinalize(() => {
      runOnJS(handleCancelTouchRef.current)();
      accumulatedWpmDelta.current = 0;
      if (!lockedRef.current) {
        runOnJS(stopPlayingRef.current)();
      }
    }), []);

  const tapGesture = useMemo(() => Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      runOnJS(handleTapLockRef.current)();
    }), []);


  const composedGesture = useMemo(() => Gesture.Exclusive(tapGesture, panGesture), [tapGesture, panGesture]);

  // ——— Focus letter split ———
  const [before, focus, after] = useMemo(() => {
    const word = activeWordStr;
    const idx = focusLetterIndex(word);
    return [word.slice(0, idx), word[idx] ?? '', word.slice(idx + 1)];
  }, [activeWordStr]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* ——— Header ——— */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={onBack} hitSlop={16} style={styles.backButton}>
            <Text style={[styles.headerButton, { color: colors.accent }]}>â† Back</Text>
          </Pressable>
          <Pressable onPress={() => setIsTocOpen(true)} hitSlop={16} style={{ marginLeft: 16 }}>
            <Text style={[styles.headerButton, { color: colors.accent, fontSize: 18 }]}>â˜°</Text>
          </Pressable>
        </View>
        <Text
          style={[styles.chapterLabel, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {chapterLabel}
        </Text>
        <View style={styles.headerRight}>
          {isLocked && (
            <View style={[styles.lockBadge, { borderColor: colors.accent }]}>
              <Text style={[styles.lockBadgeText, { color: colors.accent }]}>LOCKED</Text>
            </View>
          )}
          {isPlaying && !isLocked && (
            <View style={[styles.playingDot, { backgroundColor: colors.accent }]} />
          )}
        </View>
      </View>

      {/* â”€â”€ Reader Area â”€â”€ */}
      <GestureDetector gesture={composedGesture}>
        <View style={styles.readerArea}>
          <Animated.View style={[styles.canvas, animatedCanvasStyle]}>
            {(pages[currentPageIndex] || []).map((pIdx) => {
              const start = book.paragraphStarts?.[pIdx] || 0;
              const end = book.paragraphStarts?.[pIdx + 1] || book.words.length;
              return (
                <ParagraphRenderer 
                  key={pIdx} 
                  pIdx={pIdx} 
                  startIndex={start} 
                  endIndex={end} 
                  bookWords={book.words} 
                  saveWordLayout={saveWordLayout} 
                  saveParaLayout={saveParaLayout}
                  colors={colors}
                  fontSize={fontSize}
                  fontFamily={fontFamily}
                  activeIndex={activeIndex}
                />
              );
            })}
          </Animated.View>
        </View>
      </GestureDetector>

      {/* â”€â”€ Footer â”€â”€ */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={[styles.progressTrack, { backgroundColor: colors.progressTrack }]}>
          <Animated.View
            style={[styles.progressFill, { backgroundColor: colors.progressFill }, animatedProgressStyle]}
          />
        </View>

        <View style={styles.footerRow}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            {wpmDisplay} WPM
          </Text>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            {Math.round(progress * 100)}%
          </Text>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            {engine.currentIndex + 1} / {engine.wordCount}
          </Text>
        </View>
      </View>
      {/* â”€â”€ TOC Drawer Overlay â”€â”€ */}
      {isTocOpen && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 1000, flexDirection: 'row' }]}>
          {/* Panel */}
          <View style={[styles.tocPanel, { backgroundColor: colors.surfaceElevated ?? colors.surface, paddingTop: Math.max(insets.top, 32) }]}>
            <View style={styles.tocHeaderContainer}>
              <Text style={[styles.tocEyebrow, { color: colors.accentDeep }]}>NAVIGATION</Text>
              <Text style={[styles.tocHeroTitle, { color: colors.textPrimary }]}>Chapters</Text>
            </View>
            <FlatList
              data={book.chapters}
              keyExtractor={(_, idx) => idx.toString()}
              contentContainerStyle={styles.tocListContent}
              renderItem={({ item, index }) => {
                const isActive = chapterLabel === item.title;
                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.tocCard,
                      { borderColor: isActive ? colors.accent : colors.border, backgroundColor: pressed ? 'rgba(0,0,0,0.05)' : 'transparent' },
                    ]}
                    onPress={() => {
                      engine.seekTo(item.wordIndex);
                      updateDisplay();
                      setIsTocOpen(false);
                    }}
                  >
                    <Text style={[styles.tocCardText, { color: isActive ? colors.accent : colors.textPrimary }]} numberOfLines={2}>
                      {item.title || `Chapter ${index + 1}`}
                    </Text>
                    {isActive && (
                      <View style={[styles.tocActivePill, { backgroundColor: colors.cardGlow ?? colors.surface }]}>
                        <Text style={[styles.tocActivePillText, { color: colors.accentDeep }]}>CURRENT</Text>
                      </View>
                    )}
                  </Pressable>
                );
              }}
            />
          </View>
          {/* Dimmer */}
          <Pressable 
            style={[styles.tocDimmer, { backgroundColor: 'rgba(0,0,0,0.5)' }]} 
            onPress={() => setIsTocOpen(false)} 
          />
        </View>
      )}
    </View>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function findCurrentChapter(chapters: ChapterMarker[], wordIndex: number): ChapterMarker | null {
  let current: ChapterMarker | null = null;
  for (const ch of chapters) {
    if (ch.wordIndex <= wordIndex) current = ch;
    else break;
  }
  return current;
}

const InlineWord = ({ text, isActive, colors, fontSize, fontFamily }: any) => {
  const focusIdx = focusLetterIndex(text);
  const before = text.slice(0, focusIdx);
  const focus = text[focusIdx] ?? '';
  const after = text.slice(focusIdx + 1);

  if (!isActive) {
    return (
      <Text style={{ 
        color: colors.phantomText, 
        fontSize, 
        fontFamily: fontFamily.regular, 
        lineHeight: fontSize * 1.5, 
        opacity: 0.15,
        textShadowColor: colors.phantomText,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 2,
      }}>
        <Text>{before}</Text>
        <Text>{focus}</Text>
        <Text>{after}</Text>
      </Text>
    );
  }

  return (
    <Text style={{ fontSize, fontFamily: fontFamily.regular, lineHeight: fontSize * 1.5 }}>
      <Text style={{ color: colors.textPrimary }}>{before}</Text>
      <Text style={{ color: colors.focusRed ?? '#ff4500' }}>{focus}</Text>
      <Text style={{ color: colors.textPrimary }}>{after}</Text>
    </Text>
  );
};

const ParagraphRenderer = React.memo(({ pIdx, startIndex, endIndex, bookWords, saveWordLayout, saveParaLayout, colors, fontSize, fontFamily, activeIndex }: any) => {
    const words = useMemo(() => {
        const arr = [];
        for (let i = startIndex; i < endIndex; i++) {
            arr.push({ text: bookWords[i], absIndex: i });
        }
        return arr;
    }, [startIndex, endIndex, bookWords]);

    return (
        <View style={styles.paragraphContainer} onLayout={e => saveParaLayout(pIdx, e.nativeEvent.layout.y)}>
            {words.map(w => (
                <View key={w.absIndex} onLayout={e => saveWordLayout(w.absIndex, e.nativeEvent.layout.x, e.nativeEvent.layout.y, e.nativeEvent.layout.width, e.nativeEvent.layout.height)}>
                    <Text>
                        <InlineWord text={w.text} isActive={w.absIndex === activeIndex} colors={colors} fontSize={fontSize} fontFamily={fontFamily} />
                        <Text style={{ 
                            fontSize, 
                            lineHeight: fontSize * 1.5, 
                            color: colors.phantomText, 
                            opacity: 0.15,
                            textShadowColor: colors.phantomText,
                            textShadowOffset: { width: 0, height: 0 },
                            textShadowRadius: 2,
                        }}>{' '}</Text>
                    </Text>
                </View>
            ))}
        </View>
    );
}, (prev, next) => {
    if (prev.fontSize !== next.fontSize) return false;
    
    // Check if the active index is within this paragraph in either the previous or next state
    const prevActiveInHere = prev.activeIndex >= prev.startIndex && prev.activeIndex < prev.endIndex;
    const nextActiveInHere = next.activeIndex >= next.startIndex && next.activeIndex < next.endIndex;
    
    // If the active index is moving within or entering/leaving this paragraph, we must re-render
    if (prevActiveInHere || nextActiveInHere) return false;
    
    return prev.startIndex === next.startIndex && prev.endIndex === next.endIndex;
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  backButton: {
    minWidth: 70,
  },
  headerButton: {
    fontSize: 15,
    fontWeight: '700',
  },
  chapterLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    marginHorizontal: 12,
    opacity: 0.8,
  },
  headerRight: {
    minWidth: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  playingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  lockBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  lockBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },

  // â”€â”€ Reader â”€â”€
  readerArea: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#050505', // Deep black for premium feel
  },
  canvas: {
    position: 'absolute',
    width: SCREEN_WIDTH * 0.9,
    left: SCREEN_WIDTH * 0.05,
    top: 0,
  },
  paragraphContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 24,
  },
  overlayContainer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayPill: {
    backgroundColor: '#050505',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOpacity: 1,
    shadowRadius: 15,
    elevation: 10,
  },
  overlayText: {
    lineHeight: undefined,
  },
  wpmOverlay: {
    position: 'absolute',
    bottom: 50,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  wpmText: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
  },
  hintContainer: {
    position: 'absolute',
    bottom: 16,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  hintText: {
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
    opacity: 0.6,
  },

  // â”€â”€ Footer â”€â”€
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  progressTrack: {
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 4,
  },
  footerText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  // â”€â”€ TOC â”€â”€
  tocPanel: {
    width: '85%',
    maxWidth: 360,
    height: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
  },
  tocDimmer: {
    flex: 1,
  },
  tocHeaderContainer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  tocEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 4,
  },
  tocHeroTitle: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1,
  },
  tocListContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  tocCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  tocCardText: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  tocActivePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 99,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  tocActivePillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
// End of file
