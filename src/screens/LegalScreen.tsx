// Shows one of the legal documents (terms, privacy and so on) from
// legal/documents, chosen by the doc route param.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LegalText from '../components/LegalText';
import { useTheme } from '../context/ThemeContext';
import { AppStackParamList } from '../navigation/types';
import { Palette, spacing } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'Legal'>;

export default function LegalScreen({ route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.lg }]}
    >
      <LegalText doc={route.params.doc} />
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    content: { padding: spacing.lg },
  });
