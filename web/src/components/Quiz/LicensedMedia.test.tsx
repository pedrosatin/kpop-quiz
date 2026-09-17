import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { LicensedMedia } from "./LicensedMedia";
import { getMessages } from "../../i18n/catalog";
import type { LicensedMedia as LicensedMediaType } from "../../lib/quiz-types";

const ptMessages = getMessages("pt-BR");
const enMessages = getMessages("en");

const validMedia: LicensedMediaType = {
  asset_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Twice_photo.jpg/960px-Twice_photo.jpg",
  source_url: "https://commons.wikimedia.org/wiki/File:Twice_photo.jpg",
  creator: "Dispatch",
  license_name: "CC BY 3.0",
  license_url: "https://creativecommons.org/licenses/by/3.0/",
  subject_qid: "Q21461452",
  verified_at: "2026-01-15",
  transformations: ["crop 4:5", "resize 960x1200"],
};

describe("LicensedMedia", () => {
  describe("unanswered state (!isAnswered)", () => {
    it("renders image with alt text clue and without spoilers", () => {
      render(
        <LicensedMedia
          media={validMedia}
          isAnswered={false}
          messages={ptMessages}
        />
      );

      const image = screen.getByRole("img");
      expect(image).toHaveAttribute("src", validMedia.asset_url);
      expect(image).toHaveAttribute("alt", "Foto usada como pista desta pergunta");

      // Spoilers must not be present before answering
      expect(screen.queryByText(/Dispatch/)).toBeNull();
      expect(screen.queryByText(/CC BY 3.0/)).toBeNull();
      expect(screen.queryByText("Fonte da imagem")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("uses english alt clue when english locale messages are passed", () => {
      render(
        <LicensedMedia
          media={validMedia}
          isAnswered={false}
          messages={enMessages}
        />
      );

      const image = screen.getByRole("img");
      expect(image).toHaveAttribute("alt", "Photo used as a clue for this question");
    });
  });

  describe("answered state (isAnswered)", () => {
    it("renders credits, license link, and source link with rel='noopener noreferrer'", () => {
      render(
        <LicensedMedia
          media={validMedia}
          isAnswered={true}
          messages={ptMessages}
        />
      );

      const image = screen.getByRole("img");
      expect(image).toHaveAttribute("src", validMedia.asset_url);

      // Creator credit
      expect(screen.getByText(/Foto por Dispatch/)).toBeInTheDocument();

      // License link
      const licenseLink = screen.getByRole("link", { name: "CC BY 3.0" });
      expect(licenseLink).toHaveAttribute("href", "https://creativecommons.org/licenses/by/3.0/");
      expect(licenseLink).toHaveAttribute("target", "_blank");
      expect(licenseLink).toHaveAttribute("rel", "noopener noreferrer");

      // Source link
      const sourceLink = screen.getByRole("link", { name: "Fonte da imagem" });
      expect(sourceLink).toHaveAttribute("href", "https://commons.wikimedia.org/wiki/File:Twice_photo.jpg");
      expect(sourceLink).toHaveAttribute("target", "_blank");
      expect(sourceLink).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("renders english credits when english locale messages are passed", () => {
      render(
        <LicensedMedia
          media={validMedia}
          isAnswered={true}
          messages={enMessages}
        />
      );

      expect(screen.getByText(/Photo by Dispatch/)).toBeInTheDocument();
      const sourceLink = screen.getByRole("link", { name: "Image source" });
      expect(sourceLink).toHaveAttribute("href", "https://commons.wikimedia.org/wiki/File:Twice_photo.jpg");
      expect(sourceLink).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  describe("safe fallback with absent or invalid media", () => {
    it("renders nothing when media is null", () => {
      const { container } = render(
        <LicensedMedia
          media={null}
          isAnswered={false}
          messages={ptMessages}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when media is undefined", () => {
      const { container } = render(
        <LicensedMedia
          media={undefined}
          isAnswered={false}
          messages={ptMessages}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders friendly fallback when media has invalid license", () => {
      const invalidMedia = {
        ...validMedia,
        license_name: "CC BY-NC 4.0",
      };

      render(
        <LicensedMedia
          media={invalidMedia as any}
          isAnswered={false}
          messages={ptMessages}
        />
      );

      expect(screen.getByText("Imagem indisponível")).toBeInTheDocument();
      expect(screen.queryByRole("img")).toBeNull();
    });

    it("renders friendly fallback when media is missing required fields", () => {
      const incompleteMedia = {
        asset_url: "https://example.com/photo.jpg",
      };

      render(
        <LicensedMedia
          media={incompleteMedia as any}
          isAnswered={false}
          messages={ptMessages}
        />
      );

      expect(screen.getByText("Imagem indisponível")).toBeInTheDocument();
      expect(screen.queryByRole("img")).toBeNull();
    });

    it("renders english unavailable message for english locale", () => {
      const incompleteMedia = {
        asset_url: "https://example.com/photo.jpg",
      };

      render(
        <LicensedMedia
          media={incompleteMedia as any}
          isAnswered={false}
          messages={enMessages}
        />
      );

      expect(screen.getByText("Image unavailable")).toBeInTheDocument();
    });
  });
});
