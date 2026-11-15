export type ReferenceRole = "layout" | "typography" | "palette" | "details";
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface MediaFile {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  sha256: string;
  createdAt: string;
}
export interface Screenshot {
  id: string;
  mediaId: string;
  caption: string;
  crop?: Crop;
}
export interface Inspiration {
  id: string;
  title: string;
  url: string;
  notes: string;
  pageType: string;
  componentTypes: string[];
  tags: string[];
  screenshots: Screenshot[];
  createdAt: string;
  updatedAt: string;
}
export interface ReferenceSelection {
  referenceId: string;
  screenshotId: string;
  role: ReferenceRole;
  useCrop: boolean;
}
export interface AssetValue {
  id: string;
  name: string;
  src: string;
}
export interface ComponentConfig {
  content: Record<string, string>;
  colors: {
    background: string;
    foreground: string;
    primary: string;
    muted: string;
  };
  fontFamily: string;
  fontSize: number;
  spacing: number;
  radius: number;
  assets: AssetValue[];
}
export interface Recipe {
  name: string;
  componentType: string;
  references: ReferenceSelection[];
  instructions: string;
  config: ComponentConfig;
  assetIds: string[];
}
export interface DesignVersion {
  id: string;
  createdAt: string;
  label: string;
  code: string;
  recipe: Recipe;
}
export interface Design {
  id: string;
  name: string;
  recipe: Recipe;
  versions: DesignVersion[];
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Settings {
  model: string;
  consent: boolean;
}
export interface LibraryState {
  references: Inspiration[];
  designs: Design[];
  media: MediaFile[];
  settings: Settings;
}
export interface PreviewArtifact {
  id: string;
  url: string;
}
export interface GenerationJob {
  id: string;
  designId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  stage: string;
  error?: string;
  design?: Design;
  preview?: PreviewArtifact;
  createdAt: string;
}
export interface ModelOption {
  selector: string;
  name: string;
  provider: string;
}
export interface RestoreReport {
  references: number;
  designs: number;
  media: number;
  duplicates: number;
  conflicts: number;
}
export const DEFAULT_MODEL = "openai-codex/gpt-6.1-sol";
export const DEFAULT_CONFIG: ComponentConfig = {
  content: {
    title: "Make room for your next idea",
    description: "Shape a component from the details worth keeping.",
    buttonText: "Explore the details",
  },
  colors: {
    background: "#f5f3ed",
    foreground: "#23251f",
    primary: "#a7472b",
    muted: "#736f65",
  },
  fontFamily: "system-ui",
  fontSize: 16,
  spacing: 24,
  radius: 8,
  assets: [],
};
export function newRecipe(): Recipe {
  return {
    name: "Untitled component",
    componentType: "Hero section",
    references: [],
    instructions: "",
    config: structuredClone(DEFAULT_CONFIG),
    assetIds: [],
  };
}
export const PAGE_TYPES = [
  "Landing page",
  "Web application",
  "E-commerce",
  "Portfolio",
  "Editorial",
];
export const COMPONENT_TYPES = [
  "Hero section",
  "Tabs",
  "Card",
  "Typography",
  "Navigation",
  "Pricing",
  "Form",
  "Footer",
  "Dashboard",
];
export const REFERENCE_ROLES: ReferenceRole[] = [
  "layout",
  "typography",
  "palette",
  "details",
];
