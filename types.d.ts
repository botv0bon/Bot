declare module 'telegraf';
declare module '@solana/web3.js';
declare module 'dotenv';
declare module './userStrategy';
declare module './bot/types';
declare module './bot/helpers';
declare module './bot/strategy';
declare module './tradeSources';
declare module './helpMessages';

// Compatibility aliases to satisfy TS when full types are not available or cause namespace issues
declare type PublicKey = any;
declare type Connection = any;
declare type Transaction = any;
declare type TransactionInstruction = any;
declare type TransactionMessage = any;
declare type VersionedTransaction = any;
declare type BlockhashWithExpiryBlockHeight = any;
declare type Keypair = any;
declare type Commitment = any;
declare type KeyedAccountInfo = any;
declare type AddressLookupTableAccount = any;
declare type AccountInfo<T = any> = any;
declare type AddressLookupTableAccount = any;
declare type SendMessageOptions = any;
declare type TelegramBotType = any;
declare type TelegramMessage = any;
declare type InlineKeyboardButton = any;
declare type InlineKeyboardMarkup = any;
declare type InlineKeyboardButtonArray = any;
// Make TelegramBot available as a type and provide nested types used in code
declare type TelegramBot = any;
declare namespace TelegramBot {
	export type Message = any;
	export type Chat = any;
}

// Compatibility alias for SDK types
declare type VersionedTransactionResponse = any;