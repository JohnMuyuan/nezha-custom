import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface CustomModalDialogProps {
	open: boolean;
	onClose: () => void;
	labelledBy: string;
	className?: string;
	children: ReactNode;
}

/**
 * Accessible native modal <dialog> following modern-web-guidance:
 * - Opened via showModal() so browser provides inert page, focus trap, top layer, Esc handling
 * - Uses declarative closedby="any" for light-dismiss with pointer-bounds fallback when unsupported (Safari)
 * - Prevents background scroll via CSS overscroll-behavior on dialog:modal & dialog::backdrop
 */
export function CustomModalDialog({
	open,
	onClose,
	labelledBy,
	className,
	children,
}: CustomModalDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		if (open) {
			if (!dialog.open) {
				dialog.showModal();
			}
		} else if (dialog.open) {
			dialog.close();
		}
	}, [open]);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		const handleClose = () => {
			dialog.returnValue = "";
			onClose();
		};
		dialog.addEventListener("close", handleClose);

		// Fallback light-dismiss for browsers without native closedby support (e.g., Safari)
		let cleanupFallback: (() => void) | undefined;
		if (!("closedBy" in HTMLDialogElement.prototype)) {
			const isOutside = (e: PointerEvent) => {
				const rect = dialog.getBoundingClientRect();
				return (
					e.clientX < rect.left ||
					e.clientX > rect.right ||
					e.clientY < rect.top ||
					e.clientY > rect.bottom
				);
			};
			let pressedOutside = false;
			const onPointerDown = (e: PointerEvent) => {
				pressedOutside = isOutside(e);
			};
			const onPointerUp = (e: PointerEvent) => {
				if (pressedOutside && isOutside(e) && dialog.open) {
					dialog.close();
				}
				pressedOutside = false;
			};
			dialog.addEventListener("pointerdown", onPointerDown);
			dialog.addEventListener("pointerup", onPointerUp);
			cleanupFallback = () => {
				dialog.removeEventListener("pointerdown", onPointerDown);
				dialog.removeEventListener("pointerup", onPointerUp);
			};
		}

		return () => {
			dialog.removeEventListener("close", handleClose);
			cleanupFallback?.();
		};
	}, [onClose]);

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby={labelledBy}
			{...({ closedby: "any" } as Record<string, string>)}
			className={cn("nz-custom-modal", className)}
		>
			{open ? children : null}
		</dialog>
	);
}
