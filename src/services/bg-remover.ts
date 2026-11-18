// Background removal — calls the companion service in backend/ (FastAPI + rembg).
// The service is NOT run on the phone: rembg needs a Python server.
// Behaviour:
//   - If no BG_REMOVER_URL is set in Settings, returns { ok: false, reason: 'not-configured' }
//     and the caller keeps the original photo with a note.
//   - If the server is unreachable or errors, returns { ok: false, reason } —
//     never crashes the photo flow.
//
// The server endpoint: POST {BG_REMOVER_URL}/remove-bg with multipart field
// `file`, returns a white-background JPEG image. See backend/README.md.
//
// The upload uses XMLHttpRequest, not fetch: fetch in this React Native
// version rejects a FormData file part ({ uri, name, type }) with
// "Unsupported FormDataPart implementation", while XHR's send(FormData)
// is the path the native networking stack handles for file URIs.

import * as FileSystem from 'expo-file-system/legacy';

export type BgRemoveResult =
  | { ok: true; uri: string }
  | { ok: false; reason: 'not-configured' | 'server-error' | 'network-error'; detail?: string };

export async function removeBackground(
  photoUri: string,
  bgRemoverUrl: string,
): Promise<BgRemoveResult> {
  const base = (bgRemoverUrl || '').trim().replace(/\/$/, '');
  if (!base) return { ok: false, reason: 'not-configured' };
  try {
    const blob: Blob = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${base}/remove-bg`);
      xhr.responseType = 'blob';
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response as Blob);
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('network error'));
      const form = new FormData();
      form.append('file', {
        uri: photoUri,
        name: 'photo.jpg',
        type: 'image/jpeg',
      } as unknown as Blob);
      xhr.send(form);
    });
    const base64: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(new Error('failed to read image'));
      reader.readAsDataURL(blob);
    });
    const outUri = `${FileSystem.cacheDirectory}whitebg-${Date.now()}.jpg`;
    await FileSystem.writeAsStringAsync(outUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { ok: true, uri: outUri };
  } catch (e) {
    return {
      ok: false,
      reason: 'network-error',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
