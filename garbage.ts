import { Context, Telegraf } from "telegraf";
import { message } from 'telegraf/filters';
import { UserManager, User } from "./users";
import { RegioITApi, Event } from "./api";
import AppError from "./errors";


export default class GarbageBot {

    constructor(
        private TZ: string,
        private chat: Telegraf,
        private users: UserManager = new UserManager,
        private api: RegioITApi = new RegioITApi(),
    ) { }

    private addComands() {
        // Register
        this.chat.command('register', async (ctx) => {
            try {
                this.users.addUser(ctx.message.chat.id);
                ctx.reply('Ich habe einen Account für dich angelegt. Ich benötige noch deinen Wohnort.\n\nIn welcher Stadt wohnst du?');
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        })
        // Remove
        this.chat.command('remove', async (ctx) => {
            try {
                this.users.deleteUser(ctx.message.chat.id);
                ctx.reply('Ich habe deine vorhanden Daten gelöscht. Mit /register kannst du dich neu anmelden.');
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        });
        // Cron
        this.chat.command('cron', async (ctx) => {
            try {
                ctx.reply('Not Yet implemented.');
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        });
        // Next
        this.chat.command('next', async (ctx) => {
            try {
                let user = this.users.getUser(ctx.message.chat.id);
                const events = await this.getEvents(user, { wasteTypes: [1, 4, 7] });
                ctx.reply(`Bei der Abholung am ${events.date.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} wird folgendes mitgenommen:\n \u22C5 ${events.garbage.join('\n \u22C5 ')}`);
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        });
        // Paper
        this.chat.command('paper', async (ctx) => {
            try {      
                let user = this.users.getUser(ctx.message.chat.id);
                const events = await this.getEvents(user, { wasteTypes: [4] });
                ctx.reply(`${events.garbage[0]} wird am ${events.date.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} abgeholt.`);
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        });
        // Plastic
        this.chat.command('plastic', async (ctx) => {
            try {      
                let user = this.users.getUser(ctx.message.chat.id);
                const events = await this.getEvents(user, { wasteTypes: [1] });
                ctx.reply(`${events.garbage[0]} wird am ${events.date.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} abgeholt.`);
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        });
    }

    private async addConfigurationDialog() {
        this.chat.on(message('text'), async (ctx, next) => {
            try {
                let user = this.users.getUser(ctx.message.chat.id);

                if (!user.city || !user.street || !user.streetNumber || !user.location) {
                    await this.setLocation(user, ctx.message.text);

                    if (!user.street) {
                        ctx.reply(`In welcher Straße wohnst du?`);
                    } else if (!user.streetNumber) {
                        ctx.reply(`Wie lautet deine Hausnummer?`);
                    } else {
                        ctx.reply(`Einrichtung abgeschlossen. Mit /cron hh:mm kannst du die automatische Erinnerung einstellen.`);
                    }
                }
            } catch (error) {
                if (!(error instanceof AppError && error.code === 'UserDoesNotExistsExcpetion')) {
                    this.errorResponse(ctx, error);
                }
            }
            next();
        });
    }

    private async getEvents(user: User, filter: { wasteTypes: number[], date?: string }, retry: boolean = true): Promise<{ date: Date, garbage: string[] }> {
        try {
            return this.api.getEvents(user.location, filter).then((events: Event[]) => {

                const today: Date = new Date();
                let nextEvent: Date = new Date();

                if (filter.date) {
                    nextEvent = new Date(filter.date);
                } else {
                    events = events.filter( event => new Date(event.datum) >= today);
                    nextEvent = new Date(events[0].datum);
                    events.forEach(event => {
                        const eventDate: Date = new Date(event.datum);
                        if (eventDate < nextEvent) {
                            nextEvent = eventDate;
                        }
                    })
                }

                const garbageEvents: string[] = events
                    .filter(event => event.datum === nextEvent.toISOString().split('T')[0])
                    .map(event => this.api.getGarbageType(event.bezirk.fraktionId));


                return {
                    date: nextEvent,
                    garbage: garbageEvents
                }
            });
        } catch (error) {
            // Rerun the function after retrieving new location id (in case the locationid is no longer valid)
            if (error instanceof AppError && error.code === 'InvalidResponseExcpetion' && retry) {
                return this.setLocation(user).then(() => this.getEvents(user, filter, false));
            } else {
                throw error;
            }
        }
    }

    private async setLocation(user: User, location?: string) {
        if (!user.city) {
            await this.api.getCity(location).then(city => {
                user.city = city.name.toLowerCase();
                user.events.changed();
            });
        } else if (!user.street) {
            const city = await this.api.getCity(user.city);
            await this.api.getStreet(city, location).then(street => {
                user.street = street.name.toLowerCase();
                user.events.changed();
            });
        } else if (!user.streetNumber) {
            const city = await this.api.getCity(user.city);
            const street = await this.api.getStreet(city, user.street);
            await this.api.getStreetNumber(street, location).then(streetNumber => {
                user.streetNumber = streetNumber.nr.toLowerCase();
                user.location = streetNumber.id;
                user.events.changed();
            });
        } else if (!location) {
            const city = await this.api.getCity(user.city);
            const street = await this.api.getStreet(city, user.street);
            await this.api.getStreetNumber(street, user.streetNumber).then(streetNumber => {
                user.location = streetNumber.id;
                user.events.changed();
            });
        }
    }

    private errorResponse(ctx: Context, error: AppError) {
        if (error instanceof AppError) {
            switch (error.code) {
                case 'UserAlreadyExistsExcpetion':
                    ctx.reply(`Du bist bereits registriert. Mit /remove kannst du deinen Account löschen.`);
                    break;
                case 'CityNotFoundExcpetion':
                    ctx.reply(`Die Stadt "${ctx.text}" konnte ich nicht finden. Bitte nenne mir erneut die Stadt in der du wohnst.`);
                    break;
                case 'StreetNotFoundExcpetion':
                    ctx.reply(`Die Stadt "${ctx.text}" konnte ich nicht finden. Bitte nenne mir erneut die Stadt in der du wohnst.`);
                    break;
                case 'StreetNumberNotFoundExcpetion':
                    ctx.reply(`Die Hausnummer "${ctx.text}" konnte ich nicht finden. Bitte nenne mir erneut die Hausnummer in der du wohnst.`);
                    break;
                default:
                    ctx.reply(`Unbekannter API Fehler.`);
            }
        }
    }

    run() {
        this.addComands();
        this.addConfigurationDialog();
    }
}