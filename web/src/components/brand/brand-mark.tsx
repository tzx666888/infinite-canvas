import { cn } from "@/lib/utils";

type BrandMarkProps = {
    className?: string;
    showName?: boolean;
    showEnglish?: boolean;
    nameClassName?: string;
};

export function BrandMark({ className, showName = false, showEnglish = false, nameClassName }: BrandMarkProps) {
    return (
        <span className={cn("inline-flex items-center gap-2.5", className)}>
            <img src="/logo.svg" alt="" className="size-7 shrink-0" />
            {showName ? (
                <span className="min-w-0 leading-none">
                    <span className={cn("block whitespace-nowrap font-semibold tracking-normal", nameClassName)}>视觉画布</span>
                    {showEnglish ? <span className="mt-1.5 block whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.28em] text-sky-500">Visual Canvas</span> : null}
                </span>
            ) : null}
        </span>
    );
}
