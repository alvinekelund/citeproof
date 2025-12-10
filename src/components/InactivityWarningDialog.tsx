import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";

interface InactivityWarningDialogProps {
  open: boolean;
  countdown: number;
  onStayActive: () => void;
  onRebootNow: () => void;
}

export function InactivityWarningDialog({
  open,
  countdown,
  onStayActive,
  onRebootNow,
}: InactivityWarningDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <AlertDialogTitle className="text-xl">Session Timeout Warning</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-base">
            You've been inactive for 30 minutes. For security, all stored data will be cleared in{" "}
            <span className="font-bold text-destructive">{countdown}</span> seconds.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-4">
          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-destructive transition-all duration-1000 ease-linear"
              style={{ width: `${(countdown / 60) * 100}%` }}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onStayActive}>
            Stay Active
          </AlertDialogCancel>
          <AlertDialogAction 
            onClick={onRebootNow}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Clear Now
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
