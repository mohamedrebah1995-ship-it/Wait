# Fix for "Stuck on Loading After Login" Issue

## Problem
The app gets stuck on a loading state after attempting to sign in with Firebase Authentication.

## Root Causes
1. Auth state listener not properly resolving
2. Missing timeout on auth state checks
3. Redirect/callback issues in Capacitor apps
4. Persistence settings causing issues

## Solution

### Step 1: Add Auth State Timeout Wrapper

Add this utility function to handle auth state with a timeout:

```typescript
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';

/**
 * Waits for auth state to initialize with a timeout
 * This prevents infinite loading states
 */
export async function waitForAuthInit(timeoutMs: number = 10000): Promise<User | null> {
  const auth = getAuth();
  
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let isResolved = false;
    
    // Set timeout to prevent infinite waiting
    const timeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        if (unsubscribe) unsubscribe();
        // Resolve with null instead of rejecting to allow app to continue
        resolve(null);
        console.warn('Auth initialization timed out');
      }
    }, timeoutMs);
    
    // Listen for auth state changes
    unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeoutId);
        if (unsubscribe) unsubscribe();
        resolve(user);
      }
    }, (error) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeoutId);
        if (unsubscribe) unsubscribe();
        reject(error);
      }
    });
  });
}
```

### Step 2: Update Your Login Component

Replace your login logic with this pattern:

```typescript
import { getAuth, signInWithEmailAndPassword, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { waitForAuthInit } from './auth-utils'; // or wherever you put the above function

async function handleLogin(email: string, password: string) {
  setIsLoading(true);
  setError(null);
  
  try {
    const auth = getAuth();
    
    // Set persistence before signing in
    await setPersistence(auth, browserLocalPersistence);
    
    // Sign in
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log('Sign in successful:', userCredential.user.uid);
    
    // Wait for auth state to properly initialize (with timeout)
    await waitForAuthInit(5000);
    
    // Navigation should happen automatically via your auth state listener
    // If you need to manually navigate:
    // navigate('/dashboard');
    
  } catch (error: any) {
    console.error('Login error:', error);
    
    // Handle specific error codes
    if (error.code === 'auth/invalid-credential') {
      setError('Invalid email or password');
    } else if (error.code === 'auth/too-many-requests') {
      setError('Too many failed attempts. Please try again later.');
    } else if (error.code === 'auth/network-request-failed') {
      setError('Network error. Check your connection.');
    } else {
      setError('Login failed. Please try again.');
    }
  } finally {
    setIsLoading(false);
  }
}
```

### Step 3: Fix Your App-Level Auth State Listener

In your main App component or auth provider:

```typescript
import { useEffect, useState } from 'react';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    const auth = getAuth();
    
    // Set a maximum time for auth initialization
    const timeoutId = setTimeout(() => {
      if (!authInitialized) {
        console.warn('Auth initialization timeout - proceeding anyway');
        setLoading(false);
        setAuthInitialized(true);
      }
    }, 5000); // 5 second timeout
    
    const unsubscribe = onAuthStateChanged(auth, 
      (user) => {
        console.log('Auth state changed:', user ? 'logged in' : 'logged out');
        setUser(user);
        setLoading(false);
        setAuthInitialized(true);
        clearTimeout(timeoutId);
      },
      (error) => {
        console.error('Auth state change error:', error);
        setLoading(false);
        setAuthInitialized(true);
        clearTimeout(timeoutId);
      }
    );

    return () => {
      unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  return { user, loading, authInitialized };
}
```

### Step 4: Update Your App Root Component

```typescript
function App() {
  const { user, loading, authInitialized } = useAuth();

  // Show loading only briefly
  if (loading && !authInitialized) {
    return (
      <div className="loading-screen">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div>
      {user ? (
        <AuthenticatedApp user={user} />
      ) : (
        <LoginScreen />
      )}
    </div>
  );
}
```

### Step 5: Capacitor-Specific Fix

If you're using Capacitor, add this to your `capacitor.config.ts`:

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'your.app.id',
  appName: 'Your App',
  webDir: 'dist',
  server: {
    // Important for Firebase Auth in Capacitor
    cleartext: true,
    androidScheme: 'https'
  },
  plugins: {
    // Ensure Firebase Auth works properly
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ["google.com", "apple.com"] // adjust based on your providers
    }
  }
};

export default config;
```

### Step 6: Add Error Boundary

Create an error boundary to catch auth-related crashes:

```typescript
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AuthErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Auth error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-screen">
          <h2>Authentication Error</h2>
          <p>Please refresh the app</p>
          <button onClick={() => window.location.reload()}>
            Refresh
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

## Quick Fix for Immediate Testing

If you need a quick fix right now, add this to your login handler:

```typescript
// After signInWithEmailAndPassword succeeds:
setTimeout(() => {
  if (stillLoading) {
    setIsLoading(false);
    window.location.reload(); // Force reload to trigger auth state
  }
}, 3000); // 3 second timeout
```

## Testing Steps

1. Clear app data/cache
2. Uninstall and reinstall the app
3. Try logging in
4. Check browser console (for web) or Xcode console (for iOS) for errors
5. Verify auth state changes are being logged

## Additional Debugging

Add these console logs to track the flow:

```typescript
console.log('1. Starting login...');
// before signIn

console.log('2. Sign in successful');
// after signIn

console.log('3. Auth state changed:', user?.uid);
// in onAuthStateChanged

console.log('4. Rendering authenticated view');
// when showing authenticated UI
```

This will help identify exactly where the flow is getting stuck.
