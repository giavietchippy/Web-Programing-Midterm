import Icon from './Icon';
import { Component } from 'react';

// Guarantees the user NEVER sees a blank white page: render errors show a message + stack,
// and async errors (promises, event handlers) show a red toast at the bottom.
export default class ErrorBoundary extends Component {
  state = { error: null, info: '', globalErrors: [] };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] render error:', error, info?.componentStack);
    this.setState({ info: info?.componentStack || '' });
  }

  componentDidMount() {
    this.onErr = (e) => this.push(e.message || String(e.error));
    this.onRej = (e) => this.push(`Unhandled promise rejection: ${e.reason?.message || e.reason}`);
    window.addEventListener('error', this.onErr);
    window.addEventListener('unhandledrejection', this.onRej);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.onErr);
    window.removeEventListener('unhandledrejection', this.onRej);
  }

  push(msg) {
    this.setState((s) => ({ globalErrors: [...s.globalErrors.slice(-3), msg] }));
  }

  render() {
    const { error, info, globalErrors } = this.state;
    if (error) {
      return (
        <div className="fatal">
          <h2>Something went wrong</h2>
          <p>The app hit an error while rendering. Details below (also in the browser console, F12):</p>
          <pre>{String(error?.stack || error)}{info}</pre>
          <button onClick={() => this.setState({ error: null })}>Try again</button>{' '}
          <button className="secondary" onClick={() => location.assign('/')}>Back to lobby</button>
        </div>
      );
    }
    return (
      <>
        {this.props.children}
        {globalErrors.length > 0 && (
          <div className="err-toast">
            {globalErrors.map((m, i) => <div key={i}><Icon name="alert" size={14} /> {m}</div>)}
            <button className="secondary" onClick={() => this.setState({ globalErrors: [] })}>Dismiss</button>
          </div>
        )}
      </>
    );
  }
}
