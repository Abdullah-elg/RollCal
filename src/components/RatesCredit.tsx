import { Linking, Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// ExchangeRate-API's free feed requires this credit, linked, wherever its
// rates are used.
export default function RatesCredit() {
  const { type } = useTheme();
  return (
    <Text
      style={[type.caption, { textDecorationLine: 'underline' }]}
      accessibilityRole="link"
      onPress={() => Linking.openURL('https://www.exchangerate-api.com')}
    >
      Rates By Exchange Rate API
    </Text>
  );
}
