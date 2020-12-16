import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from "fs";
import md5 from "md5";
import * as Discord from "discord.js";
import { CronJob } from "cron";
import _ from "lodash";
const bot = new Discord.Client();

const TOKEN = process.env.TOKEN;
const LORE_FILE_NAME = "./lore.txt";
const STATE_FILE_NAME = "./state.txt";

let hashToInfo = {};
let hashes = [];
var sentHashes = [];
var unsentHashes = [];
var channelToSend = undefined;
var cronJob = undefined;

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

const getEmptyInfo = (content) => {
	return {
		times_posted: 0,
		last_posted: new Date(),
		message_ids: [],
		content,
	}
}

const reloadLore = () => {
	const LOREBITES = fs.readFileSync(LORE_FILE_NAME, 'utf8').split("\n").filter(s => s.length > 0);
	const newHashToInfo = {};
	hashes = [];
	LOREBITES.forEach(l => {
		const hash = md5(l);
		if (!(hash in hashToInfo)) {
			newHashToInfo[hash] = getEmptyInfo(l);
		} else {
			newHashToInfo[hash] = hashToInfo[hash];
		}
		hashes.push(hash);
	});
	hashToInfo = newHashToInfo;
	unsentHashes = _.difference(hashes, sentHashes);
	shuffleArray(unsentHashes);
	sentHashes = _.difference(sentHashes, hashes);
	console.info(hashToInfo);
}

const saveState = () => {
	const infoWithContentRemoved = {};
	for(const key in hashToInfo) {
		const { content, ...contentRemoved } = hashToInfo[key];
		infoWithContentRemoved[key] = contentRemoved;
	}
	const objToSave = {
		hashToInfo: infoWithContentRemoved,
		hashes,
		sentHashes,
		unsentHashes,
	}
	fs.writeFileSync(STATE_FILE_NAME, JSON.stringify(objToSave));
}

const reloadState = () => {
	return fs.readFile(STATE_FILE_NAME, (err, data) => {
		if (data === undefined || (!!err && err.code === "ENOENT")) {
			return;
		}
		const parsedInfo = JSON.parse(data.toString());
		const parsedHashToInfo = {};
		const LOREBITES = fs.readFileSync(LORE_FILE_NAME, 'utf8').split("\n").filter(s => s.length > 0);
		const hashToContent = {}
		LOREBITES.forEach(l => {
			const hash = md5(l);
			hashToContent[hash] = l;
		});
		if (_.union(Object.values(hashToContent), parsedInfo.hashes).length !== parsedInfo.hashes.length) {
			return;
		}
		for (const key in LOREBITES) {
			parsedHashToInfo[key] = {
				...parsedInfo.hashToInfo[key],
				content: hashToContent[md5(key)],
				last_posted: new Date(Date.parse(parsedInfo.hashToInfo[key].last_posted)),
			};
		}
		hashToInfo = parsedHashToInfo;
		hashes = parsedInfo.hashes;
		sentHashes = parsedInfo.sentHashes;
		unsentHashes = parsedInfo.unsentHashes;
	});
}

reloadLore();
fs.watchFile(LORE_FILE_NAME, (curr, prev) => {
	if (curr.mtime > prev.mtime) {
		reloadLore();
	}
})

const sendHash = async (hash) => {
	sentHashes.push(hash);
	const info = hashToInfo[hash];
	const content = info.content;
	const sentMessage = (await channelToSend.send(`> ${content}`)) || {"id": undefined};
	hashToInfo[hash] = {
		...info,
		times_posted: info.times_posted + 1,
		last_posted: new Date(),
		message_ids: [...info.message_ids, sentMessage.id],
	}
};

const postLore = async () => {
	if (unsentHashes.length === 0) {
		unsentHashes = [...hashes];
		shuffleArray(unsentHashes);
		sentHashes = [];
	}
	const hashToSend = unsentHashes.shift();
	await sendHash(hashToSend);
	saveState();
};


fs.watchFile(LORE_FILE_NAME, (curr, prev) => {
	if (curr.mtime > prev.mtime) {
		// Lore is updated
		reloadLore();
		saveState();
	}
});

bot.login(TOKEN);

bot.on('ready', () => {
	console.info(`Logged in as ${bot.user.tag}`);
});

bot.on('message', async msg => {
	if (msg.content.startsWith("!lorebot delete state")) {
		fs.writeFile(STATE_FILE_NAME, "");
		msg.author.send(`State deleted`);
	}
	if (msg.content.startsWith("!lorebot activate"))  {
		const info = msg.content.substr("!lorebot activate".length).trim();
		if (info.length === 0) {
			if (cronJob === undefined) {
				msg.author.send(`Sorry, I couldn't be actvivated.
								You need to give me a cron schedule first
								by sending !lorebot activate <cronjob>`);
			} else {
				cronJob.start();
			}
		} else {
			channelToSend = msg.channel;
			await reloadState();
			cronJob = new CronJob(info, postLore);
			cronJob.start();
			msg.author.send("Successfully activated lorebot")
		}
	}
	if (msg.content.startsWith("!lorebot deactivate"))  {
		if (cronJob !== undefined) {
			cronJob.stop();
			msg.author.send(`Hey! I just deactivated myself.
							Use !lorebot activate to reactivate me,
							or !lorebot activate <cronjob> to activate
							me on a new schedule`);
		}
	}
});
