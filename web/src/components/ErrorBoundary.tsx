import { Component, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	render() {
		if (this.state.hasError) {
			return (
				this.props.fallback ?? (
					<div className="p-4 text-friday-error text-sm">
						<p className="font-medium">Something went wrong</p>
						<p className="text-friday-text-dim mt-1">
							{this.state.error?.message}
						</p>
					</div>
				)
			);
		}
		return this.props.children;
	}
}
