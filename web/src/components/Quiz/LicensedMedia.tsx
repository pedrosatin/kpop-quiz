import { useEffect, useState } from "preact/hooks";
import type { Messages } from "../../i18n/catalog";
import { type LicensedMedia as LicensedMediaType, isLicensedMedia } from "../../lib/quiz-types";

export interface LicensedMediaProps {
  media?: LicensedMediaType | null | undefined;
  isAnswered: boolean;
  messages: Messages;
}

export function LicensedMedia({ media, isAnswered, messages }: LicensedMediaProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [media?.asset_url]);

  if (media === null || media === undefined) {
    return null;
  }

  if (hasError || !isLicensedMedia(media)) {
    return (
      <div class="quiz-media media-unavailable" role="status">
        <p>{messages.mediaUnavailable}</p>
      </div>
    );
  }

  return (
    <figure class="quiz-media media-figure">
      <img
        class="media-image"
        src={media.asset_url}
        alt={messages.mediaAltClue}
        loading="lazy"
        onError={() => setHasError(true)}
      />
      {isAnswered && (
        <figcaption class="media-caption media-credit">
          <span class="media-creator">
            {messages.mediaCreator} {media.creator}
          </span>
          {" · "}
          <a
            href={media.license_url}
            target="_blank"
            rel="noopener noreferrer"
            class="media-license-link"
          >
            {media.license_name}
          </a>
          {" · "}
          <a
            href={media.source_url}
            target="_blank"
            rel="noopener noreferrer"
            class="media-source-link"
          >
            {messages.mediaSource}
          </a>
        </figcaption>
      )}
    </figure>
  );
}
