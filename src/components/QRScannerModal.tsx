import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { fonts, Palette, palettes, radii, spacing, TypeTokens } from '../theme';
import { Button } from './ui';

// Safely resolve expo-camera so the app does not crash if native module isn't linked yet.
let CameraViewComponent: any = null;
let getPermissionsAsyncFn: (() => Promise<any>) | null = null;
let requestPermissionsAsyncFn: (() => Promise<any>) | null = null;

try {
  const ExpoCamera = require('expo-camera');
  CameraViewComponent = ExpoCamera.CameraView;
  getPermissionsAsyncFn = ExpoCamera.getCameraPermissionsAsync;
  requestPermissionsAsyncFn = ExpoCamera.requestCameraPermissionsAsync;
} catch (e) {
  CameraViewComponent = null;
  getPermissionsAsyncFn = null;
  requestPermissionsAsyncFn = null;
}

export function parseInviteCode(scanned: string): string | null {
  if (!scanned) return null;
  const trimmed = scanned.trim();

  // 1. Check query parameter: ?code=XYZ or &code=XYZ
  const queryMatch = trimmed.match(/[?&]code=([A-Za-z0-9_-]+)/i);
  if (queryMatch && queryMatch[1]) {
    return queryMatch[1].toUpperCase();
  }

  // 2. Check path pattern: /join/XYZ or join/XYZ
  const pathMatch = trimmed.match(/join\/([A-Za-z0-9_-]+)/i);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1].toUpperCase();
  }

  // 3. Raw invite code string (e.g. 4 to 16 alphanumeric characters)
  if (/^[A-Za-z0-9_-]{4,16}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}

type Props = {
  visible: boolean;
  onScanned: (code: string) => void;
  onClose: () => void;
  onManualEntry?: () => void;
};

export default function QRScannerModal({
  visible,
  onScanned,
  onClose,
  onManualEntry,
}: Props) {
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [torch, setTorch] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [mountError, setMountError] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const scannedRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      scannedRef.current = false;
      return;
    }

    if (!CameraViewComponent || !getPermissionsAsyncFn) {
      setMountError(true);
      return;
    }

    getPermissionsAsyncFn()
      .then((res) => {
        if (res?.granted) {
          setHasPermission(true);
        } else if (res?.status === 'denied' && !res?.canAskAgain) {
          setPermissionDenied(true);
          setHasPermission(false);
        } else {
          setHasPermission(false);
        }
      })
      .catch(() => {
        setHasPermission(false);
      });
  }, [visible]);

  const requestPermission = async () => {
    if (!requestPermissionsAsyncFn) {
      setMountError(true);
      return;
    }
    try {
      const res = await requestPermissionsAsyncFn();
      if (res?.granted) {
        setHasPermission(true);
        setPermissionDenied(false);
      } else {
        setHasPermission(false);
        if (res?.status === 'denied' && !res?.canAskAgain) {
          setPermissionDenied(true);
        }
      }
    } catch {
      setHasPermission(false);
    }
  };

  const handleBarcodeScanned = (result: { data: string; type?: string }) => {
    if (scannedRef.current) return;

    const data = result.data;
    const parsed = parseInviteCode(data);

    if (parsed) {
      scannedRef.current = true;
      onScanned(parsed);
    } else {
      scannedRef.current = true;
      setErrorNotice('Not a valid SociaLink QR code');
      setTimeout(() => {
        setErrorNotice(null);
        scannedRef.current = false;
      }, 2000);
    }
  };

  const topInset =
    Platform.OS === 'ios'
      ? Math.max(insets.top, 44)
      : (RNStatusBar.currentHeight ?? insets.top ?? 24) + spacing.xs;

  const isCameraAvailable = Boolean(CameraViewComponent) && hasPermission && !mountError;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Camera surface or permission/mount fallback */}
        {isCameraAvailable ? (
          <CameraViewComponent
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            onBarcodeScanned={handleBarcodeScanned}
            onMountError={() => setMountError(true)}
          />
        ) : (
          <View style={[styles.fallbackContainer, { paddingTop: topInset + 40 }]}>
            <Text style={type.h2}>Camera Access</Text>
            <Text style={styles.fallbackText}>
              {!CameraViewComponent || mountError
                ? 'Camera preview is not available on this simulator. You can enter the invite code manually.'
                : 'SociaLink needs camera access to scan event QR codes.'}
            </Text>
            {CameraViewComponent && !mountError && (
              <Button
                title={permissionDenied ? 'Open Settings' : 'Allow Camera'}
                onPress={() => {
                  if (permissionDenied) {
                    Linking.openSettings();
                  } else {
                    requestPermission();
                  }
                }}
                style={{ width: 200, marginBottom: spacing.md }}
              />
            )}
            {onManualEntry && (
              <Button
                title="Enter code manually"
                variant="secondary"
                onPress={() => {
                  onClose();
                  onManualEntry();
                }}
                style={{ width: 200, marginBottom: spacing.md }}
              />
            )}
            <Button
              title="Close"
              variant="secondary"
              onPress={onClose}
              style={{ width: 200 }}
            />
          </View>
        )}

        {/* Viewfinder overlay shown when camera is active */}
        {isCameraAvailable && (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {/* Top mask */}
            <View style={[styles.maskTop, { height: topInset + 80 }]} />

            <View style={styles.centerRow}>
              {/* Left mask */}
              <View style={styles.maskSide} />

              {/* Viewfinder Target */}
              <View style={styles.viewfinder}>
                {/* 4 Corner Markers */}
                <View style={[styles.corner, styles.cornerTL, { borderColor: colors.accent }]} />
                <View style={[styles.corner, styles.cornerTR, { borderColor: colors.accent }]} />
                <View style={[styles.corner, styles.cornerBL, { borderColor: colors.accent }]} />
                <View style={[styles.corner, styles.cornerBR, { borderColor: colors.accent }]} />
              </View>

              {/* Right mask */}
              <View style={styles.maskSide} />
            </View>

            {/* Bottom mask */}
            <View style={styles.maskBottom}>
              <Text style={styles.instruction}>
                Point camera at a SociaLink event QR code
              </Text>
              {errorNotice ? (
                <Text style={styles.errorBanner}>{errorNotice}</Text>
              ) : null}

              {onManualEntry ? (
                <Pressable
                  onPress={() => {
                    onClose();
                    onManualEntry();
                  }}
                  hitSlop={10}
                  style={styles.manualLink}
                >
                  <Text style={styles.manualLinkText}>Or enter invite code manually</Text>
                </Pressable>
              ) : null}
            </View>

            {/* Top Bar Navigation */}
            <View style={[styles.topBar, { top: topInset }]}>
              <Pressable onPress={onClose} hitSlop={12} style={styles.topBtn}>
                <Text style={styles.topBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => setTorch((prev) => !prev)}
                hitSlop={12}
                style={styles.topBtn}
              >
                <Text style={styles.topBtnText}>{torch ? 'Flash On' : 'Flash Off'}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const VIEWFINDER_SIZE = 250;

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palettes.dark.paper,
    },
    fallbackContainer: {
      flex: 1,
      backgroundColor: c.paper,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    fallbackText: {
      ...t.body,
      color: c.inkMuted,
      textAlign: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.xl,
      lineHeight: 22,
    },
    topBar: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      zIndex: 10,
    },
    topBtn: {
      backgroundColor: c.scrim,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: c.line,
    },
    topBtnText: {
      ...t.body,
      color: palettes.dark.ink,
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
    },
    maskTop: {
      backgroundColor: c.scrim,
    },
    centerRow: {
      height: VIEWFINDER_SIZE,
      flexDirection: 'row',
    },
    maskSide: {
      flex: 1,
      backgroundColor: c.scrim,
    },
    viewfinder: {
      width: VIEWFINDER_SIZE,
      height: VIEWFINDER_SIZE,
      position: 'relative',
    },
    corner: {
      position: 'absolute',
      width: 28,
      height: 28,
    },
    cornerTL: {
      top: 0,
      left: 0,
      borderTopWidth: 4,
      borderLeftWidth: 4,
      borderTopLeftRadius: radii.sm,
    },
    cornerTR: {
      top: 0,
      right: 0,
      borderTopWidth: 4,
      borderRightWidth: 4,
      borderTopRightRadius: radii.sm,
    },
    cornerBL: {
      bottom: 0,
      left: 0,
      borderBottomWidth: 4,
      borderLeftWidth: 4,
      borderBottomLeftRadius: radii.sm,
    },
    cornerBR: {
      bottom: 0,
      right: 0,
      borderBottomWidth: 4,
      borderRightWidth: 4,
      borderBottomRightRadius: radii.sm,
    },
    maskBottom: {
      flex: 1,
      backgroundColor: c.scrim,
      alignItems: 'center',
      paddingTop: spacing.xl,
      paddingHorizontal: spacing.lg,
    },
    instruction: {
      ...t.body,
      color: palettes.dark.ink,
      fontFamily: fonts.bodyMedium,
      textAlign: 'center',
      fontSize: 15,
    },
    errorBanner: {
      ...t.caption,
      color: c.danger,
      marginTop: spacing.sm,
      fontFamily: fonts.bodySemiBold,
    },
    manualLink: {
      marginTop: spacing.xl,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      backgroundColor: c.scrim,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: c.line,
    },
    manualLinkText: {
      ...t.caption,
      color: palettes.dark.ink,
      fontFamily: fonts.bodySemiBold,
      fontSize: 13,
    },
  });
