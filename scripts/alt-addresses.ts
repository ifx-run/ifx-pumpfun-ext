/** Static addresses for Pump × Ifx mainnet ALT — see docs/alt-addresses.zh-CN.md */

/** Tier A + B + C + default Frame + Tier B′ (optional ecosystem) */
export const ALT_ADDRESSES_CORE = [
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",
  "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
  "ifxmwWVVZDmXN2DUVf7wtJYCXTRY4QsL5rzmNkXzxbj",
  "6RNv1eQ7fogEW7R1QGg6dAiddEefGfYgJVtjpvgENtdn",
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt",
  "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y",
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
  "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
  "7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX",
  "9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz",
  "AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY",
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
  "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz",
  "G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP",
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
  "BKNnVDyzcPGCWnk8zX3Cn2KKhLASk5iTjVpxUW7YTb8P",
  "GX5xun6rCNC72WJrTx75Z7do3wLigXsKf8kDPeDVoCcv",
] as const;

/** Tier B′ — not used by bonding-curve buy/sell in this repo; safe to skip with --minimal */
export const ALT_ADDRESSES_ECOSYSTEM = [
  "CHqnuTkj6sXDFknM652aEFPECZh9qVsBXWkhPohmV9dA",
  "D6QxXDt6hhcCpto4HiZKkN2YQ2iZRF5R7S3caCHpUsML",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "HsC37rNFvJgpfH7y2Y6kqnwEQN4WfdM5FLArWnux5GUs",
  "GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR",
  "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e",
  "13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ",
  "BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s",
  "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
] as const;

/** Tier D — fee/buyback WSOL ATAs (SOL quote path) */
export const ALT_ADDRESSES_WSOL_ATAS = [
  "94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb",
  "7GFUN3bWzJMKMRZ34JLsvcqdssDbXnp589SiE33KVwcC",
  "X5QPJcpph4mBAJDzc4hRziFftSbcygV59kRb2Fu6Je1",
  "Bvtgim23rfocUzxVX9j9QFxTbBnH8JZxnaGLCEkXvjKS",
  "FGptqdxjahafaCzpZ1T6EDtCzYMv7Dyn5MgBLyB3VUFW",
  "CGEWR6pxwgQvYKeX4pZDqpZtWYPvyTjiAsw86SNzJtGy",
  "7xQYoUjUJF1Kg6WVczoTAkaNhn5syQYcbvjmFrhjWpx",
  "BWXT6RUhit9FfJQM3pBmqeFLPYmuxgmyhMGC5sGr8RbA",
  "HjQjngTDqoHE6aaGhUqfz9aQ7WZcBRjy5xB8PScLSr8i",
  "GAFuhgcd328SkkBYHpfadzmef9hTGAFRCi9QoCnsZQug",
  "AktftA98kSWAxn6kVSoqBXBELUArjKu2H9WmKB48ULFY",
  "6rVkF4HSgy1jrnC3HogfRgPHrq4CtLg5f11URpsC4i9D",
  "GYH1Gae1wJytMSvMvw8JVcv7nuAbxi8i9erNVbERnzXd",
  "CA7v8gHfbquYXyDnDx6QxWW8hmL1H7X6Y2RYDrGLnuck",
  "CASRL2zkwDnppxEFQ4LgdwgR9pdz5Q8R8nEMKVZ9QoLp",
  "qkYdTGRPHbWTWuBMz45bCiU6a23axRqf6sBHm9295WY",
] as const;

/** Tier D — fee/buyback USDC ATAs (USDC quote path); order matches WSOL list (8 protocol + 8 buyback) */
export const ALT_ADDRESSES_USDC_ATAS = [
  "BqcWAXkSdknwQxvqXYVGKtttZynYNHACPVJmTaoqgfv8",
  "3beutiWC6iV5Hz2RC711oXTqWa93rHUwsS58xWBHyTd6",
  "FC6zaBZjnJ1tF5nY4b2nrPgu62thjXdRkk2sEtjxU16E",
  "C5bwoYa7RD7Prc2u36idJ3hDjTvvoXPdBdx4iYeDVaQj",
  "APnwGpYPQJqpndpjZFUFUrzsSU2sd2SG9qKtpXQgRimu",
  "CN371Div8bqcEqq2grrGQfBX7geFLgHATEFMNLEuQs1U",
  "2yC9PAQvtxFjdV2G79N7cGsFhitbNiEQmZ3Z6dmLWfQg",
  "BMqY71czEnfwxTp7zTc3Wdkushpn8VfSJ6NGZX11djM1",
  "6oCkp6gpyjxVTeL6ahMYcekN2x2pzt1KY8g2LqemaTNE",
  "DxvbV1rR2hmFJ2gYGXmz7jnMPsvf39M1BWd3Ejshd3Zj",
  "H2CUXP4v2ZSWEFvnj9C6RbbD8cNNZPLK3H374nKARN1t",
  "9JR4rG7BK32TVENGAcKMseS7tdoz3Y5pXeSq234MEowH",
  "4EcDKGwpgYLVnMmjJCDrUN2DVLQKSpSKyMhqU1GbuMsv",
  "EZbmj4jpfk9GGgRNfzX3e13Zo4ZaNMHQ5UUmRVcZQyEF",
  "BJQ1HTx43bBDF1ba8GfZAfxSMZneTmQNr5m9yUfx6vAu",
  "fewxWzSMHpHhDT9c5FysEXnHXtxvWVeHPvFVTyZdPwh",
] as const;

export function buildAltAddressList(opts: {
  minimal?: boolean;
  includeWsolAtas?: boolean;
  includeUsdcAtas?: boolean;
}): string[] {
  const parts: readonly string[] = [
    ...ALT_ADDRESSES_CORE,
    ...(opts.minimal ? [] : ALT_ADDRESSES_ECOSYSTEM),
    ...(opts.includeWsolAtas !== false ? ALT_ADDRESSES_WSOL_ATAS : []),
    ...(opts.includeUsdcAtas !== false ? ALT_ADDRESSES_USDC_ATAS : []),
  ];
  return [...new Set(parts)];
}
