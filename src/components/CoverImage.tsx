// An event cover: the full photo, framed the way the host chose (cover_crop).
// The box sets its own shape (COVER_ASPECT); without a frame the photo is
// centred, which matches how covers looked before frames existed.

import { useState } from 'react';
import { Image, LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { CoverCrop, coverImageLayout } from '../lib/coverCrop';

type Props = {
  uri: string;
  crop: CoverCrop | null | undefined;
  style?: StyleProp<ViewStyle>;
};

export default function CoverImage({ uri, crop, style }: Props) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!box || box.w !== width || box.h !== height) setBox({ w: width, h: height });
  };
  const layout = crop && box ? coverImageLayout(crop, box.w, box.h) : null;
  return (
    <View style={[styles.box, style]} onLayout={onLayout}>
      {layout ? (
        <Image source={{ uri }} style={{ position: 'absolute', ...layout }} resizeMode="stretch" />
      ) : crop ? null : (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
});
