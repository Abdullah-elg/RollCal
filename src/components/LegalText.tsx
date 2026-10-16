import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { LEGAL, LegalDoc } from '../legal/documents';
import { Palette, spacing, TypeTokens } from '../theme';

// One legal document's body, as plain text on the page. The title is left to
// the caller (a screen header or a modal heading).
export default function LegalText({ doc }: { doc: LegalDoc }) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const { updated, intro, sections } = LEGAL[doc];

  return (
    <View>
      <Text style={type.caption}>Last updated {updated}</Text>
      <Text style={styles.paragraph}>{intro}</Text>
      {sections.map((section) => (
        <View key={section.heading}>
          <Text style={styles.heading} accessibilityRole="header">
            {section.heading}
          </Text>
          {section.paragraphs.map((p, i) => (
            <Text key={i} style={styles.paragraph}>
              {p}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    heading: { ...t.h3, marginTop: spacing.lg },
    paragraph: { ...t.body, marginTop: spacing.sm },
  });
