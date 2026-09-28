export function buildLocalizeFn(args) {
    return (value, options) => {
        const context = options?.context ? String(options.context) : "standalone";
        let valuesArray;
        if (context === "formatting" && args.formattingValues) {
            const defaultWidth = args.defaultFormattingWidth || args.defaultWidth;
            const width = (options?.width ? String(options.width) : defaultWidth);
            valuesArray = (args.formattingValues[width] ||
                args.formattingValues[defaultWidth]);
        }
        else {
            const defaultWidth = args.defaultWidth;
            const width = (options?.width ? String(options.width) : args.defaultWidth);
            valuesArray = (args.values[width] ||
                args.values[defaultWidth]);
        }
        const index = (args.argumentCallback ? args.argumentCallback(value) : value);
        // @ts-expect-error - For some reason TypeScript just don't want to match it, no matter how hard we try. I challenge you to try to remove it!
        return valuesArray[index];
    };
}
