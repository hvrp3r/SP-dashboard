import { useRef, useState } from 'react';
import { uploadImage } from '../api/uploads.js';

interface ImageUrlInputProps {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  required?: boolean;
  /** Classes du champ texte (taille/padding propres à chaque formulaire). */
  inputClassName?: string;
  className?: string;
}

/**
 * Champ image MSP : lien externe collé à la main OU fichier uploadé sur le
 * serveur (le chemin `/uploads/images/...` renvoyé remplit alors le champ).
 */
export default function ImageUrlInput({
  value,
  onChange,
  placeholder = "URL de l'image",
  required,
  inputClassName = 'px-3 py-2',
  className = '',
}: ImageUrlInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadImage(file);
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de l’upload');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className={`flex-1 min-w-[160px] ${className}`}>
      <div className="flex items-center gap-2">
        {value && (
          <img
            src={value}
            alt=""
            className="h-8 w-8 shrink-0 rounded object-contain bg-zinc-900 border border-zinc-800"
          />
        )}
        <input
          type="text"
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${inputClassName}`}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Uploader une image (PNG, JPEG, WEBP, GIF, SVG — 5 Mo max)"
          className="shrink-0 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm px-3 py-1.5 transition disabled:opacity-50"
        >
          {uploading ? 'Envoi…' : 'Uploader'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
