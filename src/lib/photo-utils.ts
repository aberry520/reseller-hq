// Photo picking shared by the item screen and the Add Item flow, so a
// photo is captured the same way in both places: the camera shows a
// square crop screen; library picks can select several photos at once
// and each is center-cropped square automatically.

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

// Center-crop a picked photo to square (1:1) — eBay displays best
// with square images. The camera picker already shows a square crop
// screen; this guarantees the result is square either way, and it is
// the only crop for library picks (the crop UI can't be shown when
// several photos are picked at once). If the crop ever fails, keep
// the original so the photo is never lost.
export const squareCropPhoto = async (
  asset: ImagePicker.ImagePickerAsset,
): Promise<string> => {
  try {
    const side = Math.min(asset.width, asset.height);
    const cropped = await ImageManipulator.manipulateAsync(
      asset.uri,
      [
        {
          crop: {
            originX: Math.round((asset.width - side) / 2),
            originY: Math.round((asset.height - side) / 2),
            width: side,
            height: side,
          },
        },
      ],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
    );
    return cropped.uri;
  } catch {
    return asset.uri;
  }
};

// Pick photos: the camera takes one photo (with the crop screen); the
// library allows selecting as many as needed in one go — handy when
// the pictures were taken earlier with the camera app. Returns the
// square-cropped URIs, or an empty array when the pick was canceled.
export const pickPhotos = async (fromCamera: boolean): Promise<string[]> => {
  if (fromCamera) {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      // Show the crop screen at capture time, locked to square (1:1)
      // for eBay, so the framing can be adjusted before the photo is
      // saved.
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]) return [];
    return [await squareCropPhoto(result.assets[0])];
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    allowsMultipleSelection: true,
  });
  if (result.canceled || !result.assets?.length) return [];
  const uris: string[] = [];
  for (const asset of result.assets) {
    uris.push(await squareCropPhoto(asset));
  }
  return uris;
};
