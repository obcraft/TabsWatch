// The exact model files Tabs Watch runs, pinned to one revision with their size and SHA-256, so a
// download can be checked, repaired file by file, and never silently changes under the user.
// Text only: the vision encoder (≈ 668 MB) is never needed for articles, so it isn't downloaded.
export const MODEL_ID = "onnx-community/Qwen3.5-2B-ONNX-OPT";
export const MODEL_REVISION = "ed446636739bf426e73c5a00714fd8e010d36c21";
export const CACHE_NAME = "transformers-cache"; // Transformers.js reads model files from this cache

const COMMON = [
  {
    path: "config.json",
    size: 2993,
    sha256: "b028de63b0ed8b37107acaaf1475d40d6d4feb5721153674e7d1d0bdbfd0f258",
  },
  {
    path: "generation_config.json",
    size: 248,
    sha256: "dc0cbe66543f310896469b7b1448af792f403293a1080baaf04d586c57b23e48",
  },
  {
    path: "tokenizer.json",
    size: 19226111,
    sha256: "89da80cc6689bef4d90cc1028249436975ffb0814618f1d93c65310e05801a9b",
  },
  {
    path: "tokenizer_config.json",
    size: 10069,
    sha256: "5dcac2c1306b11d1e18ec4c024a174bded2ca3178ce87b0aa590711696407f3d",
  },
];

// q4f16 needs a GPU with half-precision shaders (shader-f16); q4 runs everywhere.
export const DTYPE_FILES = {
  q4f16: [
    ...COMMON,
    {
      path: "onnx/embed_tokens_q4f16.onnx",
      size: 1064,
      sha256: "802a072ff21f540eda7f343aa71dbb0354c8859caaf34f09b3bf8117725d7de8",
    },
    {
      path: "onnx/embed_tokens_q4f16.onnx_data",
      size: 294010880,
      sha256: "650aa8eb39b7404ca2c908d78243c82b6fd88321feeb8fca175745806c6b3a81",
    },
    {
      path: "onnx/decoder_model_merged_q4f16.onnx",
      size: 707377,
      sha256: "c567d4d34dc97185e85bb40c9c30d6f73133858b1f8a32b90166b7fea4b653bf",
    },
    {
      path: "onnx/decoder_model_merged_q4f16.onnx_data",
      size: 1088892928,
      sha256: "06dd7841f90e5c4ecc029193a29478750ae9dcbfeaf8cfb223cf8b69cc5666d6",
    },
  ],
  q4: [
    ...COMMON,
    {
      path: "onnx/embed_tokens_q4.onnx",
      size: 857,
      sha256: "0255dd844858758f452d9678f1e2c91db178f21b7da254d29b12e7fe3d23e305",
    },
    {
      path: "onnx/embed_tokens_q4.onnx_data",
      size: 325795840,
      sha256: "9a6404d9b1c79ffc038d5c28deec04d419efb4594125453c991be38b4522ecb6",
    },
    {
      path: "onnx/decoder_model_merged_q4.onnx",
      size: 586260,
      sha256: "8207fcf67d692e251eec7f24868be5b753f402fb84a259eb4578253692701405",
    },
    {
      path: "onnx/decoder_model_merged_q4.onnx_data",
      size: 1207357440,
      sha256: "0c0f71175574f0060ed441acb1896825234ef27fcf008822c490dbfa6b0c90fe",
    },
  ],
};

export const totalSize = (dtype) => DTYPE_FILES[dtype].reduce((n, f) => n + f.size, 0);

// The address Transformers.js uses for a file, which is also its key in the cache.
export const fileUrl = (path, revision = MODEL_REVISION) =>
  `https://huggingface.co/${MODEL_ID}/resolve/${revision}/${path}`;
