const DEFAULT_OMISSION = "...";
export function truncate(dataOrN, nOrOptions, options) {
    return typeof dataOrN === "string"
        ? truncateImplementation(dataOrN,
        // @ts-expect-error [ts2345] -- We want to reduce runtime checks to a
        // minimum, and there's no (easy) way to couple params so that when we
        // check one, the others are inferred accordingly.
        nOrOptions, options)
        : (data) => truncateImplementation(data, dataOrN,
        // @ts-expect-error [ts2345] -- We want to reduce runtime checks to a
        // minimum, and there's no (easy) way to couple params so that when we
        // check one, the others are inferred accordingly.
        nOrOptions);
}
function truncateImplementation(data, n, { omission = DEFAULT_OMISSION, separator } = {}) {
    if (data.length <= n) {
        // No truncation needed.
        return data;
    }
    if (n <= 0) {
        // Avoid weirdness when n isn't positive.
        return "";
    }
    if (n < omission.length) {
        // TODO [>3]: This was an oversight, there's no value in returning just parts of the omission string itself, with no actual content. Instead, we should truncate the input without adding the omission at all in cases where the omission would completely eclipse the content.
        // Handle cases where the omission itself is too long.
        return omission.slice(0, n);
    }
    // Our trivial cutoff is the point where we can add the omission and reach
    // n exactly, this is what we'll use when no separator is provided.
    let cutoff = n - omission.length;
    if (typeof separator === "string") {
        const lastSeparator = data.lastIndexOf(separator, cutoff);
        if (lastSeparator !== -1) {
            // If we find the separator within the part of the string that would be
            // returned we move the cutoff further so that we also remove it.
            cutoff = lastSeparator;
        }
    }
    else if (separator !== undefined) {
        const globalSeparator = separator.flags.includes("g")
            ? separator
            : new RegExp(separator.source, `${separator.flags}g`);
        let lastSeparator;
        for (const { index } of data.matchAll(globalSeparator)) {
            if (index > cutoff) {
                // We only care about separators within the part of the string that
                // would be returned anyway, once we are past that point we don't care
                // about any further separators.
                break;
            }
            lastSeparator = index;
        }
        if (lastSeparator !== undefined) {
            cutoff = lastSeparator;
        }
    }
    // Build the output.
    return `${data.slice(0, cutoff)}${omission}`;
}
