// App.jsx - React frontend (chat-like UI)
import React, { useState, useRef, useEffect } from "react";
import './index.css';
import { LuSend } from "react-icons/lu";

export default function App() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);

  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]); // scrolls on message update

  const resetConversation = () => {
    setMessages([]); // Clear history
    setQuery("");    // Clear input field
  };

  const handleSearch = async () => {
    if (!query.trim()) return;

    const newMessage = {
      role: "user",
      content: query
    };

    // Construct the new messages list manually
    const updatedMessages = [...messages, newMessage];
    setQuery(""); // Clear input
    // Update the state for UI
    setMessages(updatedMessages);

    try {
      const res = await fetch("http://localhost:3001/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages}),
      });
  
      const data = await res.json();

      const responseMessages = {
        role: "system",
        content: data.reply
      };
      
      setMessages((prev) => [
        ...prev, responseMessages]);
      
      

      console.log('Azure Completion Response:', data.reply);
  
      if (!res.ok) {
        alert(data.error || "Something went wrong. Please try again.");
        return;
      }
  
      if (!data.reply) {
        alert("No answer received from the AI service.");
        return;
      }
    } catch (error) {
      console.error("Fetch failed:", error);
      alert("Network error. Please check your server.");
    }
  };


  return (
  <div className="flex items-center justify-center min-h-screen bg-gray-100">
  {/* Top-right icon */}
  <div className="flex justify-between items-start w-full px-12 py-6 absolute top-8 left-0">
    <div><span className="text-4xl text-gray-400">Smart Assistant</span>
    </div>
    <div><img src="assets/Bulb.png" alt="Logo" className="w-60 h-12" />
    </div>
  </div>

  {/* Outer container takes 3/4 of the screen width */}
  <div className="w-11/12 p-3 bg-white border border-black rounded-lg shadow-md">

  {/* Chat messages area */}
  <div className="flex flex-col h-[70vh] overflow-y-auto">
    {messages.map((msg, index) => {

      const isUser = msg.role === "user";

      const bubble = isUser ? "self-start p-3 mt-2 mr-3 rounded-xl bg-gray-300 text-slate shadow-md" : "self-start p-3 mt-2 mr-3 rounded-xl bg-gray-400 text-white shadow-md";
      // <div key={index} className="flex flex-col mb-2"className="flex flex-col mb-2">
      return (
        <div key={index} className={`${bubble}`} >
             {msg.content}
        </div>
      )
    })}
    <div ref={bottomRef} /> {/* anchor to scroll to */}
    </div>

    {/* Input area */}
    <div className="flex mt-4">
      <input
        className="flex-1 p-2 border rounded-l border-slate-400"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault(); // prevent new line (optional for textareas)
            handleSearch();
          }
        }}
        placeholder="Type your question and press Enter or hit Send button..."
      />
      <LuSend className="ml-2 h-10 w-10" onClick={handleSearch}/>
    </div>

    </div>
  </div>

  )
}