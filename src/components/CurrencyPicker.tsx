// A searchable sheet for choosing one of the currencies in lib/currency.
// Used at sign-up, in Settings and when reviewing a bill.

import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { CURRENCIES } from '../lib/currency';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { CheckIcon } from './icons';

type Props = {
  visible: boolean;
  selected: string | null;
  title?: string;
  // A line under the title saying what the choice is for.
  intro?: string;
  onSelect: (code: string) => void;
  // Omit to make the choice required (no Done button, back does nothing).
  onClose?: () => void;
};

// A searchable list of the currencies RollCal offers, as a sheet.
export default function CurrencyPicker({
  visible,
  selected,
  title = 'Currency',
  intro,
  onSelect,
  onClose,
}: Props) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const shown = q
    ? CURRENCIES.filter((c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    : CURRENCIES;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
      transparent={Platform.OS === 'android'}
      statusBarTranslucent={Platform.OS === 'android'}
      onRequestClose={() => onClose?.()}
      onDismiss={() => setQuery('')}
    >
      <View style={Platform.OS === 'android' ? styles.overlay : { flex: 1 }}>
        <SafeAreaView
          style={[styles.screen, Platform.OS === 'android' && styles.androidCard]}
          edges={['bottom']}
        >
          {Platform.OS === 'android' && (
            <View style={styles.handleBar}>
              <View style={styles.handle} />
            </View>
          )}
          <View style={styles.header}>
            <Text style={type.h2}>{title}</Text>
            {onClose && (
              <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
                <Text style={styles.done}>Done</Text>
              </Pressable>
            )}
          </View>
          {intro ? <Text style={[type.bodyMuted, styles.intro]}>{intro}</Text> : null}
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.inkMuted}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.search}
            accessibilityLabel="Search currencies"
          />
          <FlatList
            data={shown}
            keyExtractor={(c) => c.code}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={styles.divider} />}
            ListEmptyComponent={<Text style={type.bodyMuted}>No currency matches that.</Text>}
            renderItem={({ item }) => {
              const isSelected = item.code === selected;
              return (
                <Pressable
                  onPress={() => {
                    setQuery('');
                    onSelect(item.code);
                  }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={styles.code}>{item.code}</Text>
                  <Text style={[type.body, { flex: 1 }]}>{item.name}</Text>
                  {isSelected && <CheckIcon size={18} color={colors.accentText} />}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    overlay: { flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' },
    androidCard: {
      marginTop: (RNStatusBar.currentHeight ?? 24) + 12,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      overflow: 'hidden',
    },
    handleBar: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: 2 },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.line },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: Platform.OS === 'android' ? spacing.xs : spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    done: { ...t.body, fontFamily: fonts.bodySemiBold, color: c.ink },
    intro: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    search: {
      ...t.body,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.sm,
    },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52 },
    code: { ...t.body, fontFamily: fonts.bodySemiBold, width: 48 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.line },
  });
