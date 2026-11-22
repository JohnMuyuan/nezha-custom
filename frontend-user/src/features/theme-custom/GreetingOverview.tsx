import { useEffect, useMemo, useState } from "react";
import { safeLocalStorage } from "@/lib/storage";
import { useThemeConfig } from "./theme-config";

const HOLIDAY_GREETINGS: Record<string, string[]> = {
	"1-1": [
		"🎉 元旦快乐！新的一年，万事胜意～",
		"🎆 新年好！前路浩浩荡荡，万事尽可期待。",
	],
	"2-14": ["🌹 情人节快乐！愿你被世界温柔以待，有爱相伴。"],
	"2-16": ["🏮 除夕啦！今晚记得吃顿丰盛的年夜饭，岁岁常平安～"],
	"2-17": [
		"🧨 新春快乐！祝你岁岁常欢愉，年年皆胜意！",
		"🧧 大年初一！祝你新的一年财源滚滚，好运连连！",
	],
	"3-3": ["🍡 元宵节快乐！吃碗热乎的汤圆，愿生活圆圆满满甜甜美美。"],
	"3-8": ["🌸 妇女节快乐！做不被定义的自己，每一天都要闪闪发光。"],
	"4-1": ["🃏 愚人节快乐！今天听到的话要打个问号哦，不过我永远不会骗你～"],
	"4-4": ["🌿 清明时节，去踏青吧，感受春天的气息和新生的力量。"],
	"5-1": [
		"👷 劳动节快乐！致敬努力生活的你，今天请好好休息！",
		"🏖️ 五一小长假开启！把工作放一边，尽情去野吧！",
	],
	"5-4": ["🔥 青年节快乐！愿你历尽千帆，归来仍是少年。"],
	"5-10": ["💐 母亲节到了！别忘了和妈妈说声辛苦了，给她个大大的拥抱。"],
	"6-1": ["🎈 儿童节快乐！谁还不是个宝宝呢，今天允许自己长不大～"],
	"6-19": ["🐉 端午节安康！吃个甜粽还是咸粽？记得挂艾草哦！"],
	"6-21": ["👔 父亲节到了！平时不善言辞的爱，今天大声表达出来吧。"],
	"8-19": [
		"💖 七夕快乐！愿有岁月可回首，且以深情共白头。",
		"🌌 七夕之夜，哪怕是一个人也要吃顿好的犒劳自己！",
	],
	"9-10": ["🌻 教师节快乐！向人生路上所有的引路人致敬。"],
	"9-25": [
		"🌕 中秋节快乐！无论人在哪里，今晚的月色都与你共享。",
		"🥮 中秋团圆夜，记得吃块月饼，给家里打个电话哦！",
	],
	"10-1": [
		"🇨🇳 国庆快乐！愿祖国繁荣昌盛，也祝你假期愉快！",
		"🎇 祝祖国生日快乐！趁着长假去好好感受一下生活吧。",
	],
	"10-31": ["🎃 万圣节之夜！不给糖就捣蛋！今晚允许做个可爱的小捣蛋鬼～"],
	"11-26": ["🦃 感恩节快乐！感谢生命中所有的相遇和温暖。"],
	"12-24": ["🍎 平安夜快乐！记得吃个甜甜的苹果，保佑平平安安。"],
	"12-25": [
		"🎄 圣诞快乐！愿你温暖如初，好运连连～",
		"🦌 叮叮当！圣诞老人的礼物可能在路上，我的祝福先送达啦！",
	],
};

const WORKDAY_GREETINGS = {
	earlyDawn: [
		"🌅 起这么早，一定有很棒的坚持。",
		"✨ 晨光微露，早起的鸟儿有虫吃。",
		"💫 天还没亮呢，稍微歇会儿也无妨。",
	],
	morning: [
		"☀️ 早安！记得吃顿热乎的早餐。",
		"🌻 新的一天，也要元气满满哦！",
		"☕ 喝杯热茶，开启今天的打怪升级。",
	],
	lateMorning: [
		"📖 保持专注，离午饭不远啦。",
		"🎯 进度不错，继续保持这个节奏！",
		"💡 伸个懒腰，活动一下筋骨吧。",
	],
	noon: [
		"🍛 干饭时间到！好好犒劳自己。",
		"🍱 中午吃点什么好呢？别亏待胃。",
		"🥢 午饭要吃饱，下午才不愁。",
	],
	napTime: [
		"😴 闭眼眯一会儿，给大脑充个电。",
		"☁️ 趴一会儿吧，十分钟也是极好的。",
		"🌿 让眼睛休息一下，看看窗外。",
	],
	afternoon: [
		"🍵 累了就发会呆，喝杯水提提神。",
		"💪 下午的困意，用一杯冰美式打败它！",
		"🪴 坚持住，今天的任务快收尾啦。",
	],
	evening: [
		"🌇 去吹吹晚风，感受此刻的温柔。",
		"🌅 披着夕阳下班/放学，辛苦啦！",
		"🎒 收拾好心情，准备迎接夜晚吧。",
	],
	night: [
		"💻 享受自由时间，做点喜欢的事。",
		"🎵 放首轻音乐，洗去一天的疲惫。",
		"🎮 游戏、追剧、看书，现在是你的主场。",
	],
	lateNight: [
		"🛌 世界安静了，祝你好梦。",
		"🌙 别熬太晚啦，明天还要早起呢。",
		"✨ 晚安，把烦恼都留在今天吧。",
	],
};

const WEEKEND_GREETINGS = {
	earlyDawn: [
		"🤫 鸟儿都还没醒，再睡会儿吧～",
		"💤 这么早起？难道是生物钟在作祟。",
		"🌌 假期的清晨，空气都格外自由。",
	],
	morning: [
		"🛌 没有闹钟的早晨，醒了也别急着起。",
		"🥞 睡到自然醒，这才是假期的意义。",
		"☀️ 阳光正好，在被窝里多赖十分钟。",
	],
	lateMorning: [
		"🥑 早午餐是休息日才有的松弛感。",
		"📻 慢悠悠地洗漱，享受慢节奏的上午。",
		"☕ 泡杯咖啡，开启属于自己的一天。",
	],
	noon: [
		"🥘 今天的午餐值得慢慢品尝。",
		"🥡 外卖还是下馆子？今天你说了算。",
		"🍲 就算是放假，也要按时吃饭哦。",
	],
	napTime: [
		"💤 在午后的阳光里沉沉睡去～",
		"🐈 像猫咪一样，找个舒服的姿势打盹。",
		"🛋️ 沙发是个好地方，随时可以躺平。",
	],
	afternoon: [
		"🎡 彻底“虚度”这段美好的光阴吧。",
		"🎮 尽情做自己喜欢的事，别管时间。",
		"🎧 戴上耳机，把下午交给音乐和热爱。",
	],
	evening: [
		"🌇 晚风微凉，去看场心心念念的电影。",
		"🌆 假期的夕阳，连云彩都显得慵懒。",
		"🍷 傍晚的惬意，最适合发呆了。",
	],
	night: [
		"🎮 晚睡一会也没关系啦！",
		"🥳 狂欢时间到，享受这没有压力的夜晚。",
		"🍿 爆米花准备好，今晚是放松之夜。",
	],
	lateNight: [
		"🌙 修仙进度99%，该去梦里冒险了。",
		"🌌 既然不用早起，那就再看一集吧！",
		"🦉 夜猫子出没，但也别通宵哦。",
	],
};

function pickGreeting(customHolidays: string): string {
	const now = new Date();
	const holidayKey = `${now.getMonth() + 1}-${now.getDate()}`;
	const dayOfWeek = now.getDay();
	const hour = now.getHours();

	const holidayList = customHolidays
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	const isWeekend =
		dayOfWeek === 0 || dayOfWeek === 6 || holidayList.includes(holidayKey);

	let candidates: string[] = [];
	if (HOLIDAY_GREETINGS[holidayKey]) {
		candidates = HOLIDAY_GREETINGS[holidayKey];
	} else {
		const group = isWeekend ? WEEKEND_GREETINGS : WORKDAY_GREETINGS;
		if (hour >= 5 && hour < 6) candidates = group.earlyDawn;
		else if (hour >= 6 && hour < 9) candidates = group.morning;
		else if (hour >= 9 && hour < 11) candidates = group.lateMorning;
		else if (hour >= 11 && hour < 13) candidates = group.noon;
		else if (hour >= 13 && hour < 14) candidates = group.napTime;
		else if (hour >= 14 && hour < 17) candidates = group.afternoon;
		else if (hour >= 17 && hour < 19) candidates = group.evening;
		else if (hour >= 19 && hour < 23) candidates = group.night;
		else candidates = group.lateNight;
	}

	if (candidates.length <= 1) return candidates[0] || "";
	const last = safeLocalStorage.getItem("nezha_last_greeting");
	const filtered = candidates.filter((item) => item !== last);
	const pool = filtered.length > 0 ? filtered : candidates;
	const chosen = pool[Math.floor(Math.random() * pool.length)];
	safeLocalStorage.setItem("nezha_last_greeting", chosen);
	return chosen;
}

function formatSiteUptime(startDateStr: string, nowMs: number): string {
	const start = new Date(startDateStr);
	if (Number.isNaN(start.getTime())) return "";
	const diff = Math.max(0, nowMs - start.getTime());
	const d = Math.floor(diff / (1000 * 60 * 60 * 24));
	const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
	const m = Math.floor((diff / (1000 * 60)) % 60);
	const s = Math.floor((diff / 1000) % 60);
	return `网站已运行 ${d}天 ${h}小时 ${m}分 ${s}秒`;
}

export function GreetingOverview() {
	const { greeting } = useThemeConfig();
	const message = useMemo(
		() => pickGreeting(greeting.custom_holidays),
		[greeting.custom_holidays],
	);
	const [nowMs, setNowMs] = useState(() => Date.now());

	useEffect(() => {
		if (!greeting.show_uptime) return;
		const timer = setInterval(() => setNowMs(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [greeting.show_uptime]);

	const uptimeText = greeting.show_uptime
		? formatSiteUptime(greeting.start_date, nowMs)
		: "";

	return (
		<div className="flex flex-col gap-1.5 mb-1">
			{greeting.show_greeting && message && (
				<div
					className="text-base font-bold transition-colors"
					style={{
						color: "var(--nz-greeting-color)",
						textShadow:
							"0 0 8px rgba(255, 215, 0, 0.75), var(--nz-greeting-shadow)",
					}}
				>
					{message}
				</div>
			)}
			{uptimeText && (
				<div
					className="text-[13px] tabular-nums transition-colors"
					style={{ color: "var(--nz-uptime-color)" }}
				>
					{uptimeText}
				</div>
			)}
		</div>
	);
}
