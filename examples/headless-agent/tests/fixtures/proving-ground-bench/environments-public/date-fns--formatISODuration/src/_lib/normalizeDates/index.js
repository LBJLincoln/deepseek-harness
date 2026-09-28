import { constructFrom } from "../../constructFrom/index.js";
export function normalizeDates(context, ...dates) {
    const normalize = constructFrom.bind(null, context || dates.find((date) => typeof date === "object"));
    return dates.map(normalize);
}
