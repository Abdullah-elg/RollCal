import * as Location from 'expo-location';
import { useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { MapPressEvent, Marker, Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { Button } from './ui';

export type PickedLocation = {
  lat: number;
  lng: number;
  label: string;
};

type Props = {
  visible: boolean;
  // Re-opens on the previous pin when editing.
  initial?: { lat: number; lng: number } | null;
  onPick: (picked: PickedLocation) => void;
  onClose: () => void;
};

const FALLBACK_REGION: Region = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

// Full-screen map for choosing where an event is: tap to drop a pin, drag it
// to adjust, or jump to the current location. Confirming reverse-geocodes the
// pin into a readable label.
export default function LocationPicker({ visible, initial, onPick, onClose }: Props) {
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const mapRef = useRef<MapView>(null);
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    initial ?? null
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const initialRegion: Region = initial
    ? { latitude: initial.lat, longitude: initial.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }
    : FALLBACK_REGION;

  const dropPin = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      setPin({ lat: latitude, lng: longitude });
      setNotice(null);
    }
  };

  const applyCoords = (lat: number, lng: number): boolean => {
    if (
      typeof lat === 'number' &&
      !isNaN(lat) &&
      typeof lng === 'number' &&
      !isNaN(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      setPin({ lat, lng });
      mapRef.current?.animateToRegion(
        {
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        400
      );
      return true;
    }
    return false;
  };

  const useCurrentLocation = async () => {
    setNotice(null);
    setBusy(true);

    if (Platform.OS === 'ios') {
      // iOS: MapKit manages location tracking natively via Objective-C/MapKit,
      // avoiding the Expo SDK 57 Swift Concurrency crash in expo-location.
      if (userLocationRef.current) {
        applyCoords(userLocationRef.current.lat, userLocationRef.current.lng);
        setBusy(false);
        return;
      }

      // Wait up to 2.5s for MapKit's onUserLocationChange to fire
      let resolved = false;
      await new Promise<void>((resolve) => {
        const start = Date.now();
        const interval = setInterval(() => {
          if (userLocationRef.current) {
            applyCoords(userLocationRef.current.lat, userLocationRef.current.lng);
            resolved = true;
            clearInterval(interval);
            resolve();
          } else if (Date.now() - start > 2500) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });

      if (!resolved && !pin) {
        setNotice("Couldn't find you yet. Tap the map to drop a pin instead.");
      }
      setBusy(false);
      return;
    }

    // Android: use Expo Location with fallback to last known
    let resolved = false;
    try {
      // Location services may be switched off for the whole phone.
      const providerStatus = await Location.getProviderStatusAsync().catch(() => null);
      if (providerStatus && !providerStatus.locationServicesEnabled) {
        try {
          await Location.enableNetworkProviderAsync();
        } catch {
          setNotice('Location is turned off. Please turn on Location in quick settings.');
          setBusy(false);
          return;
        }
      }

      const perm = await Location.requestForegroundPermissionsAsync().catch((err) => {
        console.warn('requestForegroundPermissionsAsync error:', err);
        return null;
      });

      if (!perm || perm.status !== 'granted') {
        setNotice('Location permission denied - tap the map to drop a pin instead.');
        setBusy(false);
        return;
      }

      const lastKnown = await Location.getLastKnownPositionAsync({}).catch(() => null);
      if (lastKnown?.coords) {
        if (applyCoords(lastKnown.coords.latitude, lastKnown.coords.longitude)) {
          resolved = true;
        }
      }

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Location timeout')), 5000)
        );
        const posPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          mayShowUserSettingsDialog: true,
        });
        const pos = await Promise.race([posPromise, timeoutPromise]);
        if (pos?.coords) {
          applyCoords(pos.coords.latitude, pos.coords.longitude);
          resolved = true;
        }
      } catch (posErr: any) {
        console.warn('Android getCurrentPosition fallback notice:', posErr?.message || posErr);
      }

      if (!resolved && !pin) {
        setNotice('Could not get your location. Tap anywhere on the map to drop a pin.');
      }
    } catch (err: any) {
      console.warn('useCurrentLocation error:', err?.message || err);
      if (!pin) {
        setNotice('Could not get your location. Tap anywhere on the map to drop a pin.');
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pin) return;
    setBusy(true);
    let label = 'Dropped pin';
    try {
      const res = await Promise.race([
        fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${pin.lat}&lon=${pin.lng}&format=json`,
          { headers: { 'User-Agent': 'SociaLink-App/1.0' } }
        ),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('Geocode timeout')), 3000)
        ),
      ]);
      if (res && res.ok) {
        const data = await res.json();
        const addr = data.address;
        if (addr) {
          const main = addr.road || addr.suburb || addr.neighbourhood || addr.amenity || data.name;
          const city = addr.city || addr.town || addr.village || addr.county;
          if (main && city) label = `${main}, ${city}`;
          else if (main) label = main;
          else if (data.display_name) label = (data.display_name as string).split(',').slice(0, 2).join(',');
        }
      }
    } catch {
      // Fallback: on Android try native geocode, on iOS avoid expo-location Swift crash
      if (Platform.OS === 'android') {
        try {
          const geoPromise = Location.reverseGeocodeAsync({
            latitude: pin.lat,
            longitude: pin.lng,
          });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Native geocode timeout')), 2500)
          );
          const results = await Promise.race([geoPromise, timeoutPromise]);
          const r = (results as Location.LocationGeocodedAddress[])?.[0];
          if (r) {
            const parts = [r.name ?? r.street, r.city].filter(Boolean);
            if (parts.length > 0) label = parts.join(', ');
          }
        } catch {
          // Keep default
        }
      }
    }

    if (label === 'Dropped pin' && pin) {
      label = `Pinned location (${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)})`;
    }

    setBusy(false);
    onPick({ ...pin, label });
  };

  const topInset =
    Platform.OS === 'ios'
      ? Math.max(insets.top, 44) + spacing.xs
      : (RNStatusBar.currentHeight ?? insets.top ?? 24) + spacing.sm;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent={Platform.OS === 'android'}
      navigationBarTranslucent={Platform.OS === 'android'}
      onRequestClose={onClose}
    >
      {/* SafeAreaView doesn't get insets inside a Modal, so the footer pads
          itself with the screen's insets read outside it. */}
      <View style={styles.screen}>
        <View style={[styles.header, { paddingTop: topInset }]}>
          <Text style={type.h2}>Where is it?</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
        <Text style={[type.caption, styles.hint]}>
          Tap the map to drop a pin, or drag the pin to adjust.
        </Text>

        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          showsUserLocation={true}
          showsMyLocationButton={false}
          onUserLocationChange={(e) => {
            const coord = e.nativeEvent?.coordinate;
            if (
              coord &&
              typeof coord.latitude === 'number' &&
              typeof coord.longitude === 'number'
            ) {
              userLocationRef.current = {
                lat: coord.latitude,
                lng: coord.longitude,
              };
            }
          }}
          onPress={dropPin}
        >
          {pin && (
            <Marker
              coordinate={{ latitude: pin.lat, longitude: pin.lng }}
              draggable
              pinColor={colors.accent}
              onDragEnd={(e) => {
                const { latitude, longitude } = e.nativeEvent.coordinate;
                if (typeof latitude === 'number' && typeof longitude === 'number') {
                  setPin({ lat: latitude, lng: longitude });
                }
              }}
            />
          )}
        </MapView>

        {notice && <Text style={styles.notice}>{notice}</Text>}
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button
            title="Use current location"
            variant="secondary"
            onPress={useCurrentLocation}
            loading={busy && !pin}
            style={{ flex: 1 }}
          />
          <Button
            title="Set location"
            onPress={confirm}
            disabled={!pin}
            loading={busy && !!pin}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xs,
    },
    cancelText: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.accentText,
    },
    hint: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    map: {
      flex: 1,
      marginHorizontal: spacing.lg,
      borderRadius: radii.md,
      overflow: 'hidden',
    },
    notice: {
      ...t.caption,
      color: c.danger,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
    footer: {
      flexDirection: 'row',
      gap: spacing.sm,
      padding: spacing.lg,
    },
  });
