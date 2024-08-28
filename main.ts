import * as dotenv from "dotenv";
import { Telegraf } from 'telegraf';
import { UserManager } from './users';
import GarbageBot from './garbage';


// environment variables
dotenv.config();

const BOT_TOKEN: string = process.env.BOT_TOKEN;
const TIMEZONE: string = process.env.TZ || 'Europe/Berlin';

const users: UserManager = new UserManager();
const chat: Telegraf = new Telegraf(BOT_TOKEN);

const garbage: GarbageBot = new GarbageBot(TIMEZONE, chat, users);

try {
    garbage.run();
    chat.launch();
    
    process.once('SIGINT', () => chat.stop('SIGINT'));
    process.once('SIGTERM', () => chat.stop('SIGTERM'));
    
} catch (error) {
    console.log(error);
}